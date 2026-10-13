import PhotosUI
import SwiftUI
import UniformTypeIdentifiers
import VisionKit

/// Own entry (web: money/entry.tsx ExpenseFormSheet): anything the household buys – also drugstore, kids, gifts – with
/// a photo or PDF (read like a receipt where it fits), optional line items, who paid and whom it belongs to.
/// "Nur für mich" / a person = personal: only that person and who entered it see it.
struct ExpenseEditView: View {
    let store: ServerStore
    let entry: SpendEntry?
    let meta: SpendMeta?
    /// new entries from "Nur meins" start as personal
    var startPersonal = false
    @Environment(\.dismiss) private var dismiss
    @State private var amount = ""
    @State private var day = Date()
    @State private var where_ = ""
    @State private var category = ""
    @State private var note = ""
    @State private var tags: [String] = []
    @State private var owner: Int?
    @State private var payer: Int?
    @State private var items: [EditItem] = []
    @State private var attachment: AttachmentState = .none
    @State private var reading = false
    @State private var readNote: String?
    @State private var reason = ""
    @State private var busy = false
    @State private var confirmDelete = false
    @State private var error: String?
    @State private var photo: PhotosPickerItem?
    @State private var showFiles = false
    @State private var showScanner = false
    @State private var preview: ExportFile?
    @State private var loaded = false

    struct EditItem: Identifiable, Hashable {
        let id = UUID()
        var name = ""
        var price = ""
        var forUserId: Int?
    }
    enum AttachmentState: Equatable {
        case none
        case existing(String)
        case new(token: String, name: String)
        case removed
    }

    private var members: [MoneyMember] { meta?.members ?? [] }
    private var me: Int? { meta?.me }
    private func num(_ s: String) -> Double? { Double(s.replacingOccurrences(of: ",", with: ".").replacingOccurrences(of: " ", with: "")) }
    private var value: Double? { num(amount) }
    private func fmtIn(_ v: Double) -> String { String(format: "%.2f", v).replacingOccurrences(of: ".", with: ",") }

    var body: some View {
        Form {
            if entry == nil {
                Section { Text(L("Anything the household buys – also without a receipt, also drugstore, kids or gifts.")).font(.subheadline).foregroundStyle(Theme.ink2) }
            }
            attachmentSection
            Section {
                TextField("12,50", text: $amount).keyboardType(.decimalPad).font(.title3.monospacedDigit())
                    .accessibilityLabel(L("Amount"))
                DatePicker(L("Date"), selection: $day, in: ...Date(), displayedComponents: .date)
            } header: { Text(L("Amount")) }
            Section(L("Where")) {
                TextField(L("e.g. drugstore, bakery, market"), text: $where_)
                suggestions(meta?.stores ?? [], $where_)
            }
            Section(L("Category")) {
                FlowLayout(spacing: 6) {
                    ForEach(meta?.moneyCategories ?? [], id: \.self) { c in
                        ChoiceChip(title: c, on: category == c) { category = category == c ? "" : c }
                    }
                }
                .padding(.vertical, 4)
                TextField(L("Other …"), text: $category)
            }
            if !members.isEmpty {
                Section {
                    FlowLayout(spacing: 6) {
                        ChoiceChip(title: L("For the household"), on: owner == nil) { owner = nil }
                        if let me { ChoiceChip(title: L("Just for me"), systemImage: "lock", on: owner == me) { owner = me } }
                        ForEach(members.filter { $0.id != me }) { m in
                            ChoiceChip(title: m.name, systemImage: "lock", on: owner == m.id) { owner = m.id }
                        }
                    }
                    .padding(.vertical, 4)
                } header: { Text(L("For whom?")) } footer: {
                    Text(owner == nil ? L("Counts for the household – everyone sees it.")
                         : owner == me ? L("Personal: only you see it. It is not in the household numbers.")
                         : LF("Personal: only you and %@ see it. It is not in the household numbers.", members.first { $0.id == owner }?.name ?? ""))
                }
            }
            if members.count > 1 {
                Section(L("Who paid?")) {
                    FlowLayout(spacing: 6) {
                        ForEach(members) { m in ChoiceChip(title: m.name, on: payer == m.id) { payer = payer == m.id ? nil : m.id } }
                    }
                    .padding(.vertical, 4)
                }
            }
            itemsSection
            Section(L("Note")) { TextField(L("Note"), text: $note, axis: .vertical) }
            Section { TagEditor(label: L("Tags"), values: $tags, suggestions: meta?.tags ?? []) }
            if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
            Section {
                Button { Task { await save() } } label: { HStack { Text(L("Save")); if busy { Spacer(); ProgressView() } } }
                    .disabled(busy || reading || (value ?? 0) <= 0)
                if entry != nil { Button(L("Delete"), role: .destructive) { confirmDelete = true } }
            }
            if let e = entry {
                Section {
                    if e.excluded != nil {
                        Button(L("Count again")) { Task { await toggleExclude(e) } }
                    } else {
                        ReasonPicker(reason: $reason)
                        Button { Task { await toggleExclude(e) } } label: { Label(L("Leave out"), systemImage: "eye.slash") }
                    }
                } header: { Text(L("Don’t count in the statistics")) }
            }
        }
        .navigationTitle(entry == nil ? L("Add an expense") : L("Edit expense"))
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .confirmationDialog(L("Delete this expense?"), isPresented: $confirmDelete, titleVisibility: .visible) {
            Button(L("Delete"), role: .destructive) { Task { await delete() } }
        }
        .onChange(of: photo) { _, item in
            guard let item else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self), let img = UIImage(data: data), let jpeg = img.jpegData(compressionQuality: 0.8) {
                    await pick(jpeg, name: "beleg.jpg", mime: "image/jpeg")
                }
                photo = nil
            }
        }
        .fileImporter(isPresented: $showFiles, allowedContentTypes: [.pdf, .image]) { result in
            guard case .success(let url) = result else { return }
            let ok = url.startAccessingSecurityScopedResource()
            defer { if ok { url.stopAccessingSecurityScopedResource() } }
            guard let data = try? Data(contentsOf: url) else { return }
            let mime = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/pdf"
            Task { await pick(data, name: url.lastPathComponent, mime: mime) }
        }
        .fullScreenCover(isPresented: $showScanner) {
            DocumentScanner { images in
                showScanner = false
                if let jpeg = images.first?.jpegData(compressionQuality: 0.8) { Task { await pick(jpeg, name: "beleg.jpg", mime: "image/jpeg") } }
            } onCancel: { showScanner = false }
            .ignoresSafeArea()
        }
        .sheet(item: $preview) { f in ShareSheet(items: [f.url]).ignoresSafeArea() }
    }

    // MARK: sections

    private var attachmentSection: some View {
        Section {
            switch attachment {
            case .existing(let type):
                Button {
                    Task { await openAttachment(type) }
                } label: { Label(L("Show attachment"), systemImage: type == "application/pdf" ? "doc.richtext" : "paperclip") }
                Button(L("Remove attachment"), role: .destructive) { attachment = .removed }
            case .new(_, let name):
                HStack {
                    Label(name, systemImage: "paperclip").lineLimit(1)
                    Spacer()
                    Button { attachment = .none } label: { Image(systemName: "xmark.circle.fill") }
                        .buttonStyle(.plain).foregroundStyle(Theme.ink3).accessibilityLabel(L("Remove attachment"))
                }
            case .none, .removed:
                if VNDocumentCameraViewController.isSupported {
                    Button { showScanner = true } label: { Label(L("Photo of the receipt"), systemImage: "doc.viewfinder") }
                }
                PhotosPicker(selection: $photo, matching: .images) { Label(L("Choose photos"), systemImage: "photo") }
                Button { showFiles = true } label: { Label(L("Photo or PDF"), systemImage: "folder") }
            }
            if reading { HStack { ProgressView(); Text(L("Reading …")).foregroundStyle(Theme.ink2) } }
            if let readNote { Text(readNote).font(.caption).foregroundStyle(Theme.warning) }
        } header: { Text(L("Receipt or invoice")) }
    }

    private var itemsSection: some View {
        Section {
            ForEach($items) { $it in
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        TextField(L("What"), text: $it.name)
                        TextField("0,00", text: $it.price).keyboardType(.decimalPad).multilineTextAlignment(.trailing)
                            .frame(maxWidth: 90).accessibilityLabel(L("Price"))
                    }
                    if members.count > 1 {
                        Picker(L("For whom?"), selection: $it.forUserId) {
                            Text(L("shared")).tag(Int?.none)
                            ForEach(members) { m in Text(m.name).tag(Int?.some(m.id)) }
                        }
                        .font(.subheadline)
                    }
                }
            }
            .onDelete { items.remove(atOffsets: $0) }
            Button { items.append(EditItem()) } label: { Label(L("Add item"), systemImage: "plus") }
            if !items.isEmpty {
                let sum = items.compactMap { num($0.price) }.reduce(0, +)
                Text(LF("Items: %@", Money.format(sum))).font(.caption)
                    .foregroundStyle((value ?? 0) > 0 && abs(sum - (value ?? 0)) > 0.01 ? Theme.warning : Theme.ink3)
            }
        } header: { Text(items.isEmpty ? L("Single items (optional)") : LF("Single items (%lld)", items.count)) } footer: {
            if members.count > 1 { Text(L("An item for one person counts for them – in “Just mine” and when splitting.")) }
        }
    }

    private func suggestions(_ list: [String], _ binding: Binding<String>) -> some View {
        Group {
            if !list.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) { ForEach(list.prefix(16), id: \.self) { c in ChoiceChip(title: c, on: binding.wrappedValue == c) { binding.wrappedValue = c } } }
                }
            }
        }
    }

    // MARK: actions

    private func load() async {
        guard !loaded else { return }
        loaded = true
        guard let e = entry else {
            if startPersonal { owner = me }
            return
        }
        amount = fmtIn(e.price)
        day = SpendDates.toDate(e.day)
        where_ = e.store
        category = e.categoryOriginal == nil && e.category == L("Uncategorised") ? "" : e.category
        note = e.note ?? ""
        tags = e.tags
        guard let d = try? await store.api.expense(e.id) else { return }
        amount = fmtIn(d.amount)
        category = d.category ?? ""
        owner = d.privateFor
        payer = d.paidBy
        items = d.items.map { EditItem(name: $0.name, price: fmtIn($0.price), forUserId: $0.forUserId) }
        attachment = d.attachment.map { .existing($0.type) } ?? .none
    }

    private func pick(_ data: Data, name: String, mime: String) async {
        reading = true
        readNote = nil
        defer { reading = false }
        do {
            let r = try await store.api.uploadSpendFile(data: data, filename: name, mimeType: mime)
            attachment = .new(token: r.token, name: name)
            if let d = r.draft {
                if amount.isEmpty, let a = d.amount { amount = fmtIn(a) }
                if where_.isEmpty, let s = d.store { where_ = s }
                if let dd = d.day, Calendar.current.isDateInToday(day) { let parsed = SpendDates.toDate(dd); if parsed <= Date() { day = parsed } }
                if items.isEmpty, d.items.count > 1 { items = d.items.map { EditItem(name: $0.name, price: fmtIn($0.price)) } }
                readNote = d.note ?? (d.amount != nil ? L("Read from the file – please check.") : nil)
            }
        } catch { self.error = APIError.from(error).localizedDescription }
    }

    private func openAttachment(_ type: String) async {
        guard let e = entry else { return }
        do {
            let data = try await store.api.expenseAttachment(e.id)
            let url = FileManager.default.temporaryDirectory.appendingPathComponent(type == "application/pdf" ? "beleg.pdf" : "beleg.jpg")
            try data.write(to: url, options: [.atomic, .completeFileProtection])
            preview = ExportFile(url: url)
        } catch { self.error = APIError.from(error).localizedDescription }
    }

    private func clean(_ s: String) -> String? { let t = s.trimmingCharacters(in: .whitespaces); return t.isEmpty ? nil : t }

    private func save() async {
        guard let v = value, v > 0 else { return }
        busy = true
        defer { busy = false }
        let att: String?? = {
            switch attachment {
            case .new(let token, _): return .some(token)
            case .removed: return .some(nil)
            default: return nil
            }
        }()
        do {
            try await store.api.saveExpense(
                id: entry?.id, amount: v, day: SpendDates.fromDate(day), store: clean(where_), category: clean(category), note: clean(note), tags: tags,
                privateFor: owner, paidBy: payer,
                items: items.compactMap { i in
                    guard let n = clean(i.name), let p = num(i.price) else { return nil }
                    return ExpenseItem(name: n, qty: nil, price: p, forUserId: i.forUserId, forName: nil)
                },
                attachment: att)
            store.touch("imports")
            Haptics.success()
            dismiss()
        } catch { self.error = APIError.from(error).localizedDescription }
    }

    private func delete() async {
        guard let e = entry else { return }
        do {
            try await store.api.deleteExpense(e.id)
            store.touch("imports")
            dismiss()
        } catch { self.error = APIError.from(error).localizedDescription }
    }

    private func toggleExclude(_ e: SpendEntry) async {
        do {
            if let ex = e.excluded { try await store.api.countAgain(ex.id) }
            else { try await store.api.excludeSpend(scope: "expense", ref: String(e.id), reason: reason.isEmpty ? nil : reason) }
            store.touch("imports")
            dismiss()
        } catch { self.error = APIError.from(error).localizedDescription }
    }
}
