import SwiftUI

/// "Bons": every receipt, order and eBon with its state (to check · booked · discarded) – web: Imports.tsx "History".
/// Tap one to check and book it in. A digital receipt (eBon) can be fetched from its QR code or link.
struct ImportsListView: View {
    let store: ServerStore
    /// shown as a button when the list is opened from Geld (not from the receipt sheet itself)
    var onAddReceipt: (() -> Void)?
    @State private var items: [ImportSummary] = []
    @State private var loaded = false
    @State private var error: String?
    @State private var showEBon = false
    @State private var showShelf = false
    @State private var showText = false
    @State private var openId: Int?
    @State private var toast: ToastMessage?
    @State private var removals = PendingRemovals()
    @Environment(AppModel.self) private var app
    /// guests and children only look (no swipe to delete)
    private var canRemove: Bool { !app.isGuest && !app.isChild }

    var body: some View {
        List {
            Section {
                if let onAddReceipt {
                    Button { onAddReceipt() } label: { Label(L("Add receipt"), systemImage: "doc.text.viewfinder") }
                }
                Button { showEBon = true } label: { Label(L("Digital receipt (QR code or link)"), systemImage: "qrcode.viewfinder") }
                Button { showShelf = true } label: { Label(L("Photograph a cupboard or freezer"), systemImage: "refrigerator") }
                Button { showText = true } label: { Label(L("Type or paste lines"), systemImage: "text.alignleft") }
            } footer: {
                Text(L("Many checkouts show a QR code for the digital receipt. Scan it and ToHuus fetches the receipt."))
            }
            // receipts by e-mail: the cloud address, or the self-hosted mailbox (each hides itself where it doesn't apply)
            // (each brings its own section and starts its own loading, Design/LoadSlot.swift)
            MailAddressSection(store: store, inList: true)
            InboxStatusCard(store: store, inList: true)
            if let error {
                Section { ErrorBanner(message: error) { Task { await load() } } }
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
            }
            if loaded && items.isEmpty && error == nil {
                Section {
                    EmptyStateView(art: .receipt, title: L("Nothing imported yet"),
                                   message: L("Photograph a receipt, choose a PDF or scan the QR code of a digital receipt – ToHuus reads it and you check it here."))
                }
                .listRowBackground(Color.clear)
            } else if !items.isEmpty {
                let visible = items.filter { !removals.isHidden("import:\($0.id)") }
                let toCheck = visible.filter { $0.status == "review" }
                if !toCheck.isEmpty {
                    Section(L("To check")) { ForEach(toCheck) { row($0) } }
                }
                let rest = visible.filter { $0.status != "review" }
                if !rest.isEmpty {
                    Section(L("History")) { ForEach(rest) { row($0) } }
                }
                Section {
                    NavigationLink { ReceiptRecognitionView(store: store) } label: {
                        Label(L("Receipt recognition"), systemImage: "sparkles")
                    }
                } footer: { Text(L("How well your receipts are read, and what ToHuus learned from your corrections.")) }
            } else if !loaded {
                Section { HStack { Spacer(); ProgressView(); Spacer() } }.listRowBackground(Color.clear)
            }
        }
        .scrollContentBackground(.hidden)
        .canvasBackground()
        .navigationTitle(L("Receipts"))
        .refreshable { await load() }
        .task(id: store.revision("imports")) { await load() }
        .navigationDestination(item: $openId) { id in ImportReviewView(store: store, importId: id) }
        .sheet(isPresented: $showShelf) { StocktakeSheet(store: store) { id in openId = id } }
        .sheet(isPresented: $showText) { TextImportSheet(store: store) { id in openId = id } }
        .sheet(isPresented: $showEBon) {
            EBonSheet(store: store) { result in
                if result.duplicate == true { toast = ToastMessage(text: L("This receipt was already there.")) }
                if let id = result.id { openId = id }
            }
        }
        .toast($toast)
        .onChange(of: toast) { old, _ in removals.toastChanged(from: old) }
        .onDisappear { removals.flush() }
    }

    /// Swipe left: a receipt to check is discarded, a booked or discarded one deleted (its bookings taken back) –
    /// with "Undo" instead of asking first.
    private func remove(_ i: ImportSummary) {
        let review = i.status == "review"
        let text = review ? L("Receipt discarded.") : i.status == "applied" ? L("Receipt deleted, its bookings are taken back.") : L("Receipt deleted.")
        toast = removals.remove("import:\(i.id)", text: text) { [store] in
            do {
                if review { try await store.api.discardImport(i.id) } else { _ = try await store.api.deleteImport(i.id) }
                store.touch("imports", "stock", "shopping", "products", "money")
            } catch {
                removals.restore("import:\(i.id)")
                toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
            }
        }
    }

    private func row(_ i: ImportSummary) -> some View {
        Button { openId = i.id } label: {
            HStack(spacing: Theme.Space.s3) {
                ZStack {
                    RoundedRectangle(cornerRadius: Theme.Radius.base).fill(i.status == "applied" ? Theme.primarySoft : Theme.surface2)
                    Image(systemName: i.status == "applied" ? "checkmark.circle.fill" : "doc.text")
                        .foregroundStyle(i.status == "applied" ? Theme.primaryText : Theme.ink2)
                }
                .frame(width: 44, height: 44)
                VStack(alignment: .leading, spacing: 2) {
                    Text(i.title).font(.body).foregroundStyle(Theme.ink).lineLimit(2)
                    Text(subtitle(i)).font(.caption).foregroundStyle(Theme.ink3).lineLimit(2)
                    // where it came from – most helpful while it waits to be checked
                    if i.status == "review", let o = i.origin {
                        Text(o.label).font(.caption).foregroundStyle(Theme.ink3).lineLimit(2)
                    }
                }
                Spacer(minLength: 4)
                statusPill(i.status)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
            if canRemove {
                Button(role: .destructive) { remove(i) } label: {
                    if i.status == "review" { Label(L("Discard"), systemImage: "xmark.bin") } else { Label(L("Delete"), systemImage: "trash") }
                }
            }
        }
    }

    private func subtitle(_ i: ImportSummary) -> String {
        var parts: [String] = []
        if let s = i.shop, !s.isEmpty, !i.title.localizedCaseInsensitiveContains(s) { parts.append(s) }
        if let n = i.lines { parts.append(n == 1 ? L("1 line") : LF("%d lines", n)) }
        if let p = i.paid { parts.append(Money.format(p)) }
        if i.reconciled { parts.append(L("matched with receipt")) }
        if let d = ServerDate.parse(i.day) { parts.append(d.formatted(.dateTime.day().month(.abbreviated))) }
        return parts.joined(separator: " · ")
    }

    @ViewBuilder
    private func statusPill(_ s: String) -> some View {
        switch s {
        case "review": StatusPill(text: L("to check"), status: "expiring")
        case "applied": StatusPill(text: L("booked"), status: nil)
        default: StatusPill(text: L("discarded"), status: nil)
        }
    }

    private func load() async {
        do {
            items = try await store.api.imports()
            error = nil
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
        loaded = true
    }
}

/// Digital receipt: scan the QR code at the checkout or paste the link → POST /api/imports/url.
struct EBonSheet: View {
    let store: ServerStore
    let onImported: (UrlImportResult) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var url = ""
    @State private var showScanner = false
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Button { showScanner = true } label: { Label(L("Scan QR code"), systemImage: "qrcode.viewfinder") }
                }
                Section {
                    TextField("https://…", text: $url)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                } header: {
                    Text(L("Link to the digital receipt"))
                } footer: {
                    Text(L("REWE, Lidl, Aldi, dm and many others show a QR code for the digital receipt at the checkout."))
                }
                if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
                Section {
                    Button {
                        Task { await fetch(url) }
                    } label: {
                        HStack { Text(L("Fetch receipt")); if busy { Spacer(); ProgressView() } }
                    }
                    .disabled(busy || URL(string: url.trimmingCharacters(in: .whitespaces))?.scheme?.hasPrefix("http") != true)
                }
            }
            .themedList()
            .navigationTitle(L("Digital receipt"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } } }
            .sheet(isPresented: $showScanner) {
                ScannerSheet(title: L("Scan QR code"), symbologies: [.qr]) { code in
                    url = code
                    Task { await fetch(code) }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func fetch(_ raw: String) async {
        let link = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard link.lowercased().hasPrefix("http") else {
            error = L("That QR code is not a link to a receipt.")
            return
        }
        busy = true
        defer { busy = false }
        error = nil
        do {
            let r = try await store.api.importFromURL(link)
            store.touch("imports")
            Haptics.success()
            dismiss()
            onImported(r)
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }
}
