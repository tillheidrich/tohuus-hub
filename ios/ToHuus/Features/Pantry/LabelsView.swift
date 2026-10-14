import PDFKit
import SwiftUI
import UIKit

/// QR labels (web: pages/Labels.tsx `/etiketten`, BoxLabels in Leftovers.tsx). Pick products, places or care tasks,
/// POST /api/qr gives each a random code and its link; the A4 sheet is drawn on the device (QR via Core Image, PDF
/// via UIGraphicsPDFRenderer) and goes to AirPrint or the share sheet. Leftover and freezer boxes use the server's
/// sticker sheets (GET /api/labels/sheet.pdf|png) and the thermal printer (POST /api/labels/print).
/// A code only holds a random id: it opens ToHuus, and only signed-in household members can use it.
struct LabelsView: View {
    enum Kind: String, CaseIterable, Identifiable {
        case product, location, care, boxes
        var id: String { rawValue }
    }

    let api: APIClient
    var kind: Kind = .product
    /// e.g. the task the label is for (web `?id=`)
    var preselect: Int?
    @Environment(AppModel.self) private var app
    @State private var current: Kind = .product
    @State private var items: [Item] = []
    @State private var selected: Set<Int> = []
    @State private var search = ""
    @State private var large = false
    @State private var loading = false
    @State private var busy = false
    @State private var error: String?
    @State private var hasFreezer = true
    @State private var preview: LabelSheetFile?
    @State private var started = false

    struct Item: Identifiable, Hashable {
        let id: Int
        let title: String
        let sub: String
        var imagePath: String?
        var symbol: String
    }

    private var shown: [Item] {
        let q = search.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return items }
        return items.filter { "\($0.title) \($0.sub)".range(of: q, options: [.caseInsensitive, .diacriticInsensitive]) != nil }
    }

    var body: some View {
        List {
            Section {
                Picker(L("What to label"), selection: $current) {
                    Text(L("Products")).tag(Kind.product)
                    Text(L("Places")).tag(Kind.location)
                    Text(L("Care tasks")).tag(Kind.care)
                    Text(hasFreezer ? L("Leftovers & frozen") : L("Leftovers")).tag(Kind.boxes)
                }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
            }
            if current == .boxes {
                BoxLabelsSections(api: api)
            } else {
                pickSections
            }
        }
        .themedList()
        .navigationTitle(L("QR labels"))
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $search, prompt: L("Search …"))
        .safeAreaInset(edge: .bottom) { if current != .boxes { bottomBar } }
        .task {
            if !started { started = true; current = kind; if let preselect { selected = [preselect] } }
            if let m = try? await api.labelsMeta() { hasFreezer = m.hasFreezer ?? true }
        }
        .task(id: current) { await load() }
        .onChange(of: current) { _, _ in
            selected = preselect.map { [$0] } ?? []
            search = ""
        }
        .sheet(item: $preview) { f in LabelSheetPreview(file: f) }
    }

    // MARK: products, places, care tasks

    @ViewBuilder private var pickSections: some View {
        Section {
            Text(hint + " " + L("The code only contains a random id – it opens ToHuus Hub, and only household members who are logged in can use it."))
                .font(.footnote).foregroundStyle(Theme.ink2)
            Picker(L("Size"), selection: $large) {
                Text(L("Small (24 per page)")).tag(false)
                Text(L("Large (8 per page)")).tag(true)
            }
        }
        if let error { Section { ErrorBanner(message: error) { Task { await load() } } }.listRowBackground(Color.clear) }
        if loading && items.isEmpty {
            Section { HStack { Spacer(); ProgressView(); Spacer() } }
        } else if shown.isEmpty {
            Section {
                EmptyStateView(systemImage: "qrcode",
                               title: search.isEmpty ? L("Nothing to label yet") : LF("Nothing for “%@”", search),
                               message: search.isEmpty ? (current == .care ? L("Labels for care tasks appear once you have a task.") : L("Labels appear here for everything you keep at home.")) : nil)
                    .listRowBackground(Color.clear)
            }
        } else {
            Section {
                let all = !shown.isEmpty && shown.allSatisfy { selected.contains($0.id) }
                Button {
                    if all { shown.forEach { selected.remove($0.id) } } else { shown.forEach { selected.insert($0.id) } }
                } label: {
                    Label(LF("Select all (%d)", shown.count), systemImage: all ? "checkmark.square.fill" : "square")
                        .font(.body.weight(.semibold))
                }
                .foregroundStyle(Theme.ink)
                ForEach(shown) { x in row(x) }
            }
        }
    }

    private var hint: String {
        switch current {
        case .location: return L("Scan: what’s in here") + "."
        case .care: return L("Scan: mark as done") + "."
        default: return L("Scan: took one, opened, on the list, where is it") + "."
        }
    }

    private func row(_ x: Item) -> some View {
        let on = selected.contains(x.id)
        return Button {
            if on { selected.remove(x.id) } else { selected.insert(x.id) }
        } label: {
            HStack(spacing: Theme.Space.s3) {
                Image(systemName: on ? "checkmark.circle.fill" : "circle")
                    .font(.title3)
                    .foregroundStyle(on ? Theme.primary : Theme.ink3)
                if let path = x.imagePath {
                    RemoteImage(url: api.imageURL(path), api: api, placeholder: "shippingbox")
                        .frame(width: 36, height: 36)
                        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.sm))
                } else {
                    Image(systemName: x.symbol).foregroundStyle(Theme.primaryText)
                        .frame(width: 36, height: 36)
                        .background(Theme.surface2, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
                        .accessibilityHidden(true)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(x.title).foregroundStyle(Theme.ink)
                    if !x.sub.isEmpty { Text(x.sub).font(.caption).foregroundStyle(Theme.ink3).lineLimit(1) }
                }
                Spacer(minLength: 0)
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private var bottomBar: some View {
        HStack(spacing: Theme.Space.s3) {
            Text(selected.count == 1 ? L("1 label") : LF("%d labels", selected.count))
                .font(.subheadline).foregroundStyle(Theme.ink2)
            Spacer()
            if busy { ProgressView() }
            if selected.count == 1, let id = selected.first {
                NFCWriteButton(api: api, kind: current.rawValue, id: id) { error = $0 }
            }
            Button(L("Preview")) { Task { await build(print: false) } }
                .buttonStyle(.bordered)
                .disabled(selected.isEmpty || busy)
            Button {
                Task { await build(print: true) }
            } label: { Label(L("Print"), systemImage: "printer") }
                .buttonStyle(.borderedProminent).tint(Theme.primary)
                .disabled(selected.isEmpty || busy)
        }
        .padding(.horizontal, Theme.Space.s4)
        .padding(.vertical, Theme.Space.s3)
        .background(.bar)
    }

    private func load() async {
        guard current != .boxes else { return }
        loading = true
        defer { loading = false }
        do {
            switch current {
            case .product:
                items = try await api.products().map {
                    Item(id: $0.id, title: $0.name, sub: [$0.brand, $0.size].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "),
                         imagePath: $0.imagePath, symbol: "shippingbox")
                }
            case .location:
                items = try await api.placeTree().filter { !$0.isArchived && !$0.isSystem }.map {
                    Item(id: $0.id, title: $0.label, sub: $0.hint ?? "", symbol: PlaceIcon.symbol($0.icon))
                }
            case .care:
                items = try await api.care().tasks.map {
                    Item(id: $0.id, title: $0.name, sub: $0.location?.name ?? "", symbol: CareLabels.icon($0.template, category: $0.category))
                }
            case .boxes:
                break
            }
            error = nil
        } catch { self.error = APIError.from(error).localizedDescription }
    }

    private func build(print: Bool) async {
        busy = true
        defer { busy = false }
        do {
            let ids = items.map(\.id).filter { selected.contains($0) }
            let labels = try await api.qrLabels(kind: current.rawValue, ids: ids)
            guard !labels.isEmpty else { error = L("Nothing to print."); return }
            let data = QRSheetRenderer.pdf(labels, large: large, hint: hint)
            let file = LabelSheetFile(data: data, name: L("QR labels"))
            if print { LabelPrinting.print(data, name: file.name) } else { preview = file }
        } catch { self.error = APIError.from(error).localizedDescription }
    }
}

// MARK: - leftover & freezer boxes

/// Leftover and freezer containers (web BoxLabels): choose boxes, sticker sheet layout and how many stickers are
/// already used, then the PDF (AirPrint / share), the label images, or the thermal printer when one is set up.
struct BoxLabelsSections: View {
    let api: APIClient
    var initialCodes: [String] = []
    @Environment(AppModel.self) private var app
    @State private var boxes: [BoxPick] = []
    @State private var meta: LabelsMeta?
    @State private var chosen: Set<String>?
    @State private var layout = "3x8"
    @State private var skip = 0
    @State private var thermalSmall = false
    @State private var previewImage: UIImage?
    @State private var loaded = false
    @State private var busy = false
    @State private var error: String?
    @State private var toast: String?
    @State private var putAway = false
    @State private var shareItems: ShareItems?
    @State private var sheetFile: LabelSheetFile?

    private var picked: [BoxPick] {
        let set = chosen ?? Set((initialCodes.isEmpty ? boxes.filter { $0.wantsLabel && $0.printedAt == nil } : boxes.filter { initialCodes.contains($0.code) }).map(\.code))
        return boxes.filter { set.contains($0.code) }
    }
    private var current: LabelsMeta.Layout? { meta?.layouts.first { $0.key == layout } }
    private var perPage: Int { current?.perPage ?? 24 }

    var body: some View {
        Group {
            Section {
                Text(L("One label per container: big name, date, eat-by and a QR code. Scanning it marks eaten, thawed or thrown away. Only household members who are logged in can open it."))
                    .font(.footnote).foregroundStyle(Theme.ink2)
                if app.store != nil {
                    Button { putAway = true } label: { Label(L("Put something away"), systemImage: "takeoutbag.and.cup.and.straw") }
                }
            }
            if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
            if let toast { Section { Label(toast, systemImage: "checkmark.circle").foregroundStyle(Theme.primaryText) } }
            if !loaded {
                Section { HStack { Spacer(); ProgressView(); Spacer() } }
            } else if boxes.isEmpty {
                Section {
                    if app.store != nil {
                        EmptyStateView(systemImage: "takeoutbag.and.cup.and.straw", title: L("No leftovers or frozen portions yet"),
                                       message: L("After cooking, tap “Leftovers” – or freeze something from stock. Each container gets its own label here."),
                                       actionTitle: L("Put something away"), action: { putAway = true })
                            .listRowBackground(Color.clear)
                    } else {
                        EmptyStateView(systemImage: "takeoutbag.and.cup.and.straw", title: L("No leftovers or frozen portions yet"),
                                       message: L("After cooking, tap “Leftovers” – or freeze something from stock. Each container gets its own label here."))
                            .listRowBackground(Color.clear)
                    }
                }
            } else {
                pickSection
                outputSection
            }
        }
        .task { await load() }
        .task(id: "\(picked.map(\.code).joined(separator: ","))|\(layout)|\(skip)") { await loadPreview() }
        .sheet(isPresented: $putAway, onDismiss: { Task { await load() } }) {
            if let store = app.store { LeftoversSheet(store: store) }
        }
        .sheet(item: $shareItems) { s in ShareSheet(items: s.items).presentationDetents([.medium, .large]) }
        .sheet(item: $sheetFile) { f in LabelSheetPreview(file: f) }
    }

    private var pickSection: some View {
        Section {
            let allOn = boxes.allSatisfy { b in picked.contains { $0.code == b.code } }
            Button {
                chosen = allOn ? [] : Set(boxes.map(\.code))
            } label: {
                Label(LF("Select all (%d)", boxes.count), systemImage: allOn ? "checkmark.square.fill" : "square").font(.body.weight(.semibold))
            }
            .foregroundStyle(Theme.ink)
            ForEach(boxes) { b in
                let on = picked.contains { $0.code == b.code }
                Button {
                    var set = Set(picked.map(\.code))
                    if on { set.remove(b.code) } else { set.insert(b.code) }
                    chosen = set
                } label: {
                    HStack(spacing: Theme.Space.s3) {
                        Image(systemName: on ? "checkmark.circle.fill" : "circle").font(.title3).foregroundStyle(on ? Theme.primary : Theme.ink3)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(b.name).foregroundStyle(Theme.ink)
                            Text(sub(b)).font(.caption).foregroundStyle(Theme.ink3)
                        }
                        Spacer(minLength: 0)
                        Text(b.prettyCode).font(.caption.monospaced()).foregroundStyle(Theme.ink3)
                    }
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityElement(children: .combine)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
    }

    private func sub(_ b: BoxPick) -> String {
        let left = b.left ?? 0
        let portions = left == 1 ? L("1 portion") : LF("%@ portions", left.rounded() == left ? String(Int(left)) : String(format: "%.1f", left))
        return [portions,
                b.place == "freezer" ? L("Freezer") : L("Fridge"),
                ServerDate.shortDay(b.eatBy).map { LF("eat by %@", $0) },
                b.printedAt != nil ? L("printed") : b.wantsLabel ? L("no label yet") : L("no label wanted")]
            .compactMap { $0 }.joined(separator: " · ")
    }

    private var outputSection: some View {
        Section {
            if let layouts = meta?.layouts, !layouts.isEmpty {
                Picker(L("Sticker sheet"), selection: $layout) {
                    ForEach(layouts) { l in Text(l.key.replacingOccurrences(of: "x", with: " × ")).tag(l.key) }
                }
                .pickerStyle(.segmented)
            }
            Stepper(value: $skip, in: 0...max(0, perPage - 1)) {
                LabeledContent(L("Already used"), value: skip == 0 ? L("none") : String(skip))
            }
            if let img = previewImage, !picked.isEmpty {
                Image(uiImage: img).resizable().scaledToFit()
                    .frame(maxHeight: 360)
                    .frame(maxWidth: .infinity)
                    .overlay(RoundedRectangle(cornerRadius: Theme.Radius.sm).stroke(Theme.line))
                    .accessibilityLabel(L("Preview"))
            }
            Button {
                Task { await pdf(print: true) }
            } label: { Label(L("PDF for printing"), systemImage: "printer") }
                .disabled(picked.isEmpty || busy)
            Button {
                Task { await pdf(print: false) }
            } label: { Label(L("Share the PDF"), systemImage: "square.and.arrow.up") }
                .disabled(picked.isEmpty || busy)
            Button {
                Task { await images() }
            } label: { Label(L("Images"), systemImage: "photo.on.rectangle") }
                .disabled(picked.isEmpty || busy)
            if let printer = meta?.printers.first {
                Picker(L("Label size"), selection: $thermalSmall) {
                    Text(L("Normal")).tag(false)
                    Text(L("Small")).tag(true)
                }
                .pickerStyle(.segmented)
                Button {
                    Task { await thermal() }
                } label: { Label(LF("Print on %@", printer.name), systemImage: "printer.dotmatrix") }
                    .disabled(picked.isEmpty || busy)
            }
        } header: {
            Text(L("Sticker sheet"))
        } footer: {
            if let c = current, let w = c.w, let h = c.h {
                Text(LF("%d labels of %@ × %@ mm per A4 page. Print at actual size (100 %%).", perPage, mm(w), mm(h)))
            }
        }
    }

    private func mm(_ v: Double) -> String { v.formatted(.number.precision(.fractionLength(0...1))) }

    private func load() async {
        do {
            async let b = api.boxPicks()
            async let m = try? api.labelsMeta()
            boxes = try await b
            meta = await m ?? meta
            if let first = meta?.layouts.first, !(meta?.layouts.contains { $0.key == layout } ?? false) { layout = first.key }
            error = nil
        } catch { self.error = APIError.from(error).localizedDescription }
        loaded = true
    }

    private func loadPreview() async {
        let codes = picked.map(\.code)
        guard !codes.isEmpty else { previewImage = nil; return }
        try? await Task.sleep(nanoseconds: 300_000_000)
        if Task.isCancelled { return }
        if let d = try? await api.boxSheetPreview(codes, layout: layout, skip: skip), let img = UIImage(data: d) { previewImage = img }
    }

    private func pdf(print: Bool) async {
        busy = true
        defer { busy = false }
        do {
            let data = try await api.boxSheetPDF(picked.map(\.code), layout: layout, skip: skip)
            let file = LabelSheetFile(data: data, name: L("Labels"))
            if print { LabelPrinting.print(data, name: file.name) } else { sheetFile = file }
            await load()
        } catch { self.error = APIError.from(error).localizedDescription }
    }

    private func images() async {
        busy = true
        defer { busy = false }
        var out: [UIImage] = []
        for b in picked.prefix(24) {
            if let d = try? await api.getData("api/labels/boxes/\(b.code)/label.png"), let img = UIImage(data: d) { out.append(img) }
        }
        if out.isEmpty { error = L("The label couldn't be loaded."); return }
        shareItems = ShareItems(items: out)
    }

    private func thermal() async {
        busy = true
        defer { busy = false }
        do {
            let r = try await api.printBoxLabels(picked.map(\.code), size: thermalSmall ? "small" : "normal")
            let n = r["labels"]?.int ?? picked.count
            let printer = r["printer"]?.string ?? ""
            toast = n == 1 ? LF("1 label printing on %@", printer) : LF("%d labels printing on %@", n, printer)
            await load()
        } catch { self.error = APIError.from(error).localizedDescription }
    }
}

struct ShareItems: Identifiable {
    let items: [Any]
    let id = UUID()
}

// MARK: - sheet, preview, print

/// A finished label sheet (PDF) – shown, printed or shared.
struct LabelSheetFile: Identifiable {
    let data: Data
    let name: String
    let id = UUID()

    /// a temporary file with a readable name for the share sheet
    var url: URL? {
        let u = FileManager.default.temporaryDirectory.appendingPathComponent("\(name).pdf")
        do { try data.write(to: u, options: .atomic); return u } catch { return nil }
    }
}

struct LabelSheetPreview: View {
    let file: LabelSheetFile
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            LabelPDFView(data: file.data)
                .ignoresSafeArea(edges: .bottom)
                .navigationTitle(L("Preview"))
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button(L("Done")) { dismiss() } }
                    ToolbarItemGroup(placement: .primaryAction) {
                        if let u = file.url {
                            ShareLink(item: u) { Image(systemName: "square.and.arrow.up") }
                                .accessibilityLabel(L("Share"))
                        }
                        Button { LabelPrinting.print(file.data, name: file.name) } label: { Image(systemName: "printer") }
                            .accessibilityLabel(L("Print"))
                    }
                }
                .safeAreaInset(edge: .bottom) {
                    Text(L("A4, no scaling (“actual size”). Plain paper and tape work; sticker sheets work better."))
                        .font(.footnote).foregroundStyle(Theme.ink2)
                        .padding(Theme.Space.s3)
                        .frame(maxWidth: .infinity)
                        .background(.bar)
                }
        }
    }
}

struct LabelPDFView: UIViewRepresentable {
    let data: Data

    func makeUIView(context: Context) -> PDFView {
        let v = PDFView()
        v.autoScales = true
        v.displayMode = .singlePageContinuous
        v.backgroundColor = .secondarySystemBackground
        v.document = PDFDocument(data: data)
        return v
    }

    func updateUIView(_ v: PDFView, context: Context) {}
}

enum LabelPrinting {
    /// AirPrint at actual size (or "Save to Files" from the print dialog)
    @MainActor static func print(_ data: Data, name: String) {
        let pc = UIPrintInteractionController.shared
        let info = UIPrintInfo(dictionary: nil)
        info.outputType = .general
        info.jobName = name
        pc.printInfo = info
        pc.printingItem = data
        if UIDevice.current.userInterfaceIdiom == .pad,
           let window = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first?.keyWindow {
            pc.present(from: CGRect(x: window.bounds.midX, y: 60, width: 1, height: 1), in: window, animated: true, completionHandler: nil)
        } else {
            pc.present(animated: true, completionHandler: nil)
        }
    }
}

/// The A4 sheet the web prints (styles.css `.label-sheet`): 8 mm margins, small = 3 × 8 labels (QR left, text right),
/// large = 2 × 4 labels (QR on top, text centred). Dashed cut lines.
enum QRSheetRenderer {
    private static let mm: CGFloat = 72 / 25.4

    static func pdf(_ labels: [QrLabel], large: Bool, hint: String) -> Data {
        let page = CGRect(x: 0, y: 0, width: 210 * mm, height: 297 * mm)
        let margin = 8 * mm
        let cols = large ? 2 : 3
        let rows = large ? 4 : 8
        let cellW = (page.width - 2 * margin) / CGFloat(cols)
        let cellH = (large ? 69.6 : 34.8) * mm
        let perPage = cols * rows
        let fmt = UIGraphicsPDFRendererFormat()
        fmt.documentInfo = [kCGPDFContextTitle as String: L("QR labels"), kCGPDFContextCreator as String: "ToHuus"]
        return UIGraphicsPDFRenderer(bounds: page, format: fmt).pdfData { ctx in
            for (i, label) in labels.enumerated() {
                if i % perPage == 0 { ctx.beginPage() }
                let k = i % perPage
                let cell = CGRect(x: margin + CGFloat(k % cols) * cellW, y: margin + CGFloat(k / cols) * cellH, width: cellW, height: cellH)
                draw(label, in: cell, large: large, hint: hint, ctx: ctx.cgContext)
            }
        }
    }

    private static func draw(_ l: QrLabel, in cell: CGRect, large: Bool, hint: String, ctx: CGContext) {
        // cut line
        ctx.saveGState()
        ctx.setStrokeColor(UIColor(white: 0.83, alpha: 1).cgColor)
        ctx.setLineWidth(0.5)
        ctx.setLineDash(phase: 0, lengths: [3, 3])
        ctx.stroke(cell.insetBy(dx: 0.25, dy: 0.25))
        ctx.restoreGState()
        let inner = cell.insetBy(dx: (large ? 4 : 2.5) * mm, dy: (large ? 4 : 2.5) * mm)
        let qrSide = large ? min(inner.width * 0.6, inner.height - 18 * mm) : min(28 * mm, inner.height)
        let qrRect: CGRect
        let textRect: CGRect
        if large {
            qrRect = CGRect(x: inner.midX - qrSide / 2, y: inner.minY, width: qrSide, height: qrSide)
            textRect = CGRect(x: inner.minX, y: qrRect.maxY + 2 * mm, width: inner.width, height: inner.maxY - qrRect.maxY - 2 * mm)
        } else {
            qrRect = CGRect(x: inner.minX, y: inner.midY - qrSide / 2, width: qrSide, height: qrSide)
            textRect = CGRect(x: qrRect.maxX + 3 * mm, y: inner.minY, width: inner.maxX - qrRect.maxX - 3 * mm, height: inner.height)
        }
        if let qr = QRCode.image(l.url)?.cgImage {
            ctx.saveGState()
            ctx.interpolationQuality = .none
            UIImage(cgImage: qr).draw(in: qrRect)
            ctx.restoreGState()
        }
        let para = NSMutableParagraphStyle()
        para.alignment = large ? .center : .left
        para.lineBreakMode = .byWordWrapping
        let text = NSMutableAttributedString(string: l.title, attributes: [
            .font: UIFont.systemFont(ofSize: large ? 14 : 9.5, weight: .bold), .foregroundColor: UIColor(red: 0.09, green: 0.11, blue: 0.10, alpha: 1), .paragraphStyle: para,
        ])
        if let s = l.sub, !s.isEmpty {
            text.append(NSAttributedString(string: "\n" + s, attributes: [
                .font: UIFont.systemFont(ofSize: large ? 10 : 7.5), .foregroundColor: UIColor(red: 0.28, green: 0.29, blue: 0.31, alpha: 1), .paragraphStyle: para,
            ]))
        }
        text.append(NSAttributedString(string: "\n" + hint, attributes: [
            .font: UIFont.systemFont(ofSize: large ? 8 : 6), .foregroundColor: UIColor(red: 0.52, green: 0.53, blue: 0.55, alpha: 1), .paragraphStyle: para,
        ]))
        // vertically centred in the small layout, from the top in the large one
        let needed = text.boundingRect(with: CGSize(width: textRect.width, height: .greatestFiniteMagnitude), options: [.usesLineFragmentOrigin], context: nil).height
        let h = min(needed, textRect.height)
        let r = large ? CGRect(x: textRect.minX, y: textRect.minY, width: textRect.width, height: h)
            : CGRect(x: textRect.minX, y: textRect.midY - h / 2, width: textRect.width, height: h)
        ctx.saveGState()
        ctx.clip(to: textRect)
        text.draw(with: r, options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine], context: nil)
        ctx.restoreGState()
    }
}
