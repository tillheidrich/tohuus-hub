import AudioToolbox
import SafariServices
import SwiftUI

// Party mode for the host (web: Party.tsx StartSheet, MenuEditor, TvSheet, GuestQrSheet, RecapSheet, KitchenBoard).
// The TV board itself (/party/board/:token, /party pairing) stays a web page on purpose – it runs on a TV or tablet
// browser without an account. From here it can be shared, opened, or shown on the TV with AirPlay screen mirroring.

// MARK: - start

struct StartPartySheet: View {
    let store: ServerStore
    let onStarted: (PartyInfo) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var products: [BarProduct]?
    @State private var templates: [PartyTemplate] = []
    @State private var name = L("Party")
    @State private var hours = 5.0
    @State private var idle = true
    @State private var names = false
    @State private var items: [PartyMenuPick]?
    @State private var template: Int?
    @State private var busy = false
    @State private var error: String?

    private var barDefault: [PartyMenuPick] {
        (products ?? []).filter(\.isOrderable).map { PartyMenuPick(productId: $0.id, maxPerGuest: nil) }
    }
    private var menu: [PartyMenuPick] { items ?? barDefault }

    var body: some View {
        NavigationStack {
            Form {
                if !templates.isEmpty {
                    Section {
                        FlowLayout(spacing: 8) {
                            ForEach(templates) { t in
                                ChoiceChip(title: t.name, on: template == t.id) { pick(t) }
                                    .contextMenu {
                                        Button(role: .destructive) { Task { await removeTemplate(t) } } label: { Label(L("Remove"), systemImage: "trash") }
                                    }
                            }
                        }
                        .padding(.vertical, 4)
                    } header: { Text(L("Like last time")) }
                }
                Section {
                    TextField(L("Mira’s birthday, barbecue …"), text: $name)
                        .onChange(of: name) { _, v in if v.count > 60 { name = String(v.prefix(60)) } }
                } header: { Text(L("Name")) }
                Section {
                    Picker(L("Ends"), selection: $hours) {
                        Text(L("in 3 h")).tag(3.0)
                        Text(L("in 5 h")).tag(5.0)
                        Text(L("in 8 h")).tag(8.0)
                        Text(L("in 12 h")).tag(12.0)
                    }
                    .pickerStyle(.segmented)
                } header: { Text(L("Ends")) }
                Section {
                    Toggle(isOn: $idle) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(L("End early when it’s quiet"))
                            Text(L("After 90 minutes without an order. You get a heads-up 15 minutes before.")).font(.caption).foregroundStyle(Theme.ink3)
                        }
                    }
                    Toggle(isOn: $names) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(L("Guest names on the TV"))
                            Text(L("Off: the TV only shows order numbers.")).font(.caption).foregroundStyle(Theme.ink3)
                        }
                    }
                    NavigationLink {
                        PartyMenuEditor(store: store, products: products ?? [], items: Binding(get: { menu }, set: { items = $0 }))
                            .navigationTitle(L("Party menu"))
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(L("Party menu"))
                            Text(menuSummary).font(.caption).foregroundStyle(Theme.ink3)
                        }
                    }
                    .disabled(products == nil)
                } footer: {
                    if products != nil && barDefault.isEmpty && items == nil {
                        Text(L("Your bar menu is still empty – add a few things under “Party menu”."))
                    }
                }
                .tint(Theme.primary)
                if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
            }
            .themedList()
            .navigationTitle(L("Start a party"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } }
            }
            .safeAreaInset(edge: .bottom) {
                Button { Task { await start() } } label: {
                    HStack { Label(L("Start now"), systemImage: "party.popper"); if busy { ProgressView().tint(Theme.onPrimary) } }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(busy || menu.isEmpty || name.trimmingCharacters(in: .whitespaces).isEmpty)
                .padding(Theme.Space.s4)
                .background(.bar)
            }
            .task {
                async let p = store.api.barProducts()
                async let t = store.api.partyTemplates()
                products = (try? await p) ?? []
                templates = (try? await t) ?? []
            }
        }
    }

    private var menuSummary: String {
        if products == nil { return "…" }
        if menu.isEmpty { return L("Nothing selected yet") }
        if items == nil { return LF("All %d bar items", menu.count) }
        return menu.count == 1 ? L("1 item") : LF("%d items", menu.count)
    }

    private func pick(_ t: PartyTemplate) {
        template = t.id
        items = t.items
        if let s = t.settings?.showNames { names = s }
        if let i = t.settings?.idleMin { idle = i > 0 }
        if name.isEmpty || name == L("Party") { name = t.name }
    }

    private func removeTemplate(_ t: PartyTemplate) async {
        try? await store.api.deletePartyTemplate(t.id)
        templates.removeAll { $0.id == t.id }
        if template == t.id { template = nil }
    }

    private func start() async {
        busy = true
        defer { busy = false }
        do {
            let p = try await store.api.startParty(name: name.trimmingCharacters(in: .whitespaces), hours: hours, idleMin: idle ? 90 : 0,
                                                   items: menu, showNames: names, templateId: template)
            dismiss()
            onStarted(p)
        } catch { self.error = APIError.from(error).localizedDescription }
    }
}

// MARK: - party menu

/// The menu of the running party (web Party.tsx MenuSheet).
struct PartyMenuSheet: View {
    let store: ServerStore
    let party: PartyInfo
    let onSaved: (PartyInfo) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var products: [BarProduct]?
    @State private var items: [PartyMenuPick] = []
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Group {
                if let products {
                    PartyMenuEditor(store: store, products: products, items: $items)
                } else {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .navigationTitle(L("Party menu"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(L("Save menu")) { Task { await save() } }.disabled(busy || items.isEmpty)
                }
            }
            .alert(L("Couldn’t save"), isPresented: Binding(get: { error != nil }, set: { if !$0 { error = nil } })) {
                Button(L("OK"), role: .cancel) {}
            } message: { Text(error ?? "") }
            .task {
                items = party.menu.map { PartyMenuPick(productId: $0.productId, maxPerGuest: $0.maxPerGuest) }
                products = (try? await store.api.barProducts()) ?? []
            }
        }
    }

    private func save() async {
        busy = true
        defer { busy = false }
        do {
            let p = try await store.api.setPartyMenu(party.id, items: items)
            onSaved(p)
            Haptics.success()
            dismiss()
        } catch { self.error = APIError.from(error).localizedDescription }
    }
}

/// Pick what's on the party menu: bar items by switch, anything else in stock by search; optional max per guest.
struct PartyMenuEditor: View {
    let store: ServerStore
    let products: [BarProduct]
    @Binding var items: [PartyMenuPick]
    @State private var query = ""

    static let limits: [Int?] = [nil, 1, 2, 3, 5]

    private var on: [Int: PartyMenuPick] { Dictionary(items.map { ($0.productId, $0) }, uniquingKeysWith: { a, _ in a }) }
    private var bar: [BarProduct] { products.filter(\.isOrderable) }
    private var extras: [BarProduct] {
        let byId = Dictionary(products.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        return items.compactMap { byId[$0.productId] }.filter { !$0.isOrderable }
    }
    private var hits: [BarProduct] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return [] }
        let chosen = on
        return Array(products.filter { !$0.isOrderable && chosen[$0.id] == nil && $0.inStock && "\($0.brand ?? "") \($0.name)".lowercased().contains(q) }.prefix(8))
    }

    var body: some View {
        List {
            Section {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ChoiceChip(title: L("All bar items"), on: false) {
                            let current = on
                            items = bar.map { current[$0.id] ?? PartyMenuPick(productId: $0.id, maxPerGuest: nil) }
                                + items.filter { i in !bar.contains { $0.id == i.productId } }
                        }
                        ChoiceChip(title: L("Only what’s there"), on: false) {
                            let byId = Dictionary(products.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
                            items = items.filter { byId[$0.productId]?.inStock == true }
                        }
                        ChoiceChip(title: L("None"), on: false) { items = [] }
                    }
                    .padding(.vertical, 4)
                }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 0))
            }
            if !bar.isEmpty {
                Section(L("From the bar")) {
                    ForEach(bar) { p in row(p, removable: false) }
                }
            }
            Section {
                ForEach(extras) { p in row(p, removable: true) }
                HStack {
                    Image(systemName: "magnifyingglass").foregroundStyle(Theme.ink3)
                    TextField(L("Add anything in stock – crisps, sparkling wine …"), text: $query).autocorrectionDisabled()
                }
                ForEach(hits) { p in
                    Button {
                        items.append(PartyMenuPick(productId: p.id, maxPerGuest: nil))
                        query = ""
                        Haptics.tick()
                    } label: {
                        HStack(spacing: Theme.Space.s3) {
                            ProductThumb(path: p.imagePath, api: store.api, size: 36)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(p.name).foregroundStyle(Theme.ink)
                                Text(p.amountText).font(.caption).foregroundStyle(Theme.ink3)
                            }
                            Spacer(minLength: 0)
                            Image(systemName: "plus.circle").foregroundStyle(Theme.primaryText).accessibilityLabel(L("Add"))
                        }
                    }
                }
                if !query.trimmingCharacters(in: .whitespaces).isEmpty && hits.isEmpty {
                    Text(LF("Nothing in stock matches “%@”.", query.trimmingCharacters(in: .whitespaces))).font(.caption).foregroundStyle(Theme.ink3)
                }
            } header: { Text(L("More from the house")) } footer: {
                Text(L("Tap “no limit” to set a maximum per guest, e.g. 2 ice creams for each child."))
            }
            Section {
                NavigationLink { MenuEditorView(store: store) } label: {
                    Label(L("Edit the menu itself – pictures, choices, coffee …"), systemImage: "pencil")
                }
            }
        }
        .themedList()
    }

    private func row(_ p: BarProduct, removable: Bool) -> some View {
        let sel = on[p.id]
        return HStack(spacing: Theme.Space.s3) {
            ProductThumb(path: p.imagePath, api: store.api, size: 40)
            VStack(alignment: .leading, spacing: 2) {
                Text(p.name).foregroundStyle(Theme.ink).lineLimit(2)
                Text(p.amountText).font(.caption).foregroundStyle(p.inStock ? Theme.ink3 : Theme.low)
            }
            Spacer(minLength: 0)
            if let sel {
                Menu {
                    ForEach(Self.limits, id: \.self) { n in
                        Button(n.map { LF("max. %d", $0) } ?? L("no limit")) { setLimit(p.id, n) }
                    }
                } label: {
                    Text(sel.maxPerGuest.map { LF("max. %d", $0) } ?? L("no limit"))
                        .font(.caption.weight(.semibold))
                        .padding(.horizontal, 10).padding(.vertical, 6)
                        .foregroundStyle(sel.maxPerGuest != nil ? Theme.onPrimary : Theme.ink2)
                        .background(sel.maxPerGuest != nil ? Theme.primary : Theme.surface2, in: Capsule())
                }
                .accessibilityLabel(L("Max per guest"))
            }
            if removable {
                Button { items.removeAll { $0.productId == p.id } } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.ink3) }
                    .buttonStyle(.borderless)
                    .frame(minWidth: 44, minHeight: 44)
                    .accessibilityLabel(L("Remove"))
            } else {
                Toggle(p.name, isOn: Binding(get: { sel != nil }, set: { v in
                    if v { items.append(PartyMenuPick(productId: p.id, maxPerGuest: nil)) } else { items.removeAll { $0.productId == p.id } }
                }))
                .labelsHidden()
                .tint(Theme.primary)
            }
        }
    }

    private func setLimit(_ id: Int, _ n: Int?) {
        if let i = items.firstIndex(where: { $0.productId == id }) { items[i].maxPerGuest = n }
    }
}

// MARK: - TV

/// "Show on TV" (web TvSheet): the 4-digit code for /party on the TV browser, or the board link as QR / share.
/// The board stays a web page for the TV; on an Apple TV it can be mirrored from here with AirPlay.
struct PartyTVSheet: View {
    let api: APIClient
    @State var party: PartyInfo
    let onUpdate: (PartyInfo) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var copied = false
    @State private var showBoard = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    VStack(alignment: .leading, spacing: Theme.Space.s2) {
                        step(1, L("Open this address in the TV or tablet browser:"))
                        Text(host).font(.title3.monospaced().weight(.semibold)).foregroundStyle(Theme.ink).textSelection(.enabled)
                    }
                    VStack(alignment: .leading, spacing: Theme.Space.s2) {
                        step(2, L("Enter this code:"))
                        if let code = party.pairCode {
                            HStack(spacing: 8) {
                                ForEach(Array(code.enumerated()), id: \.offset) { _, d in
                                    Text(String(d))
                                        .font(.system(size: 36, weight: .bold, design: .rounded)).monospacedDigit()
                                        .frame(width: 52, height: 64)
                                        .background(Theme.surface2, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
                                }
                            }
                            .accessibilityElement(children: .ignore)
                            .accessibilityLabel(code.map(String.init).joined(separator: " "))
                        } else {
                            Text(L("The code has expired.")).font(.subheadline).foregroundStyle(Theme.ink3)
                        }
                        Button(L("New code")) { Task { await newCode() } }.buttonStyle(.bordered)
                    }
                } header: { Text(L("Show on TV")) }
                if let url = party.boardUrl {
                    Section {
                        HStack(alignment: .center, spacing: Theme.Space.s4) {
                            if let qr = QRCode.image(url) {
                                Image(uiImage: qr).interpolation(.none).resizable().scaledToFit()
                                    .frame(width: 132, height: 132)
                                    .padding(6)
                                    .background(Color.white, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
                                    .accessibilityLabel(L("QR code of the board link"))
                            }
                            Text(L("The board link only shows – it can’t change anything. It stops working when the party ends."))
                                .font(.caption).foregroundStyle(Theme.ink2)
                        }
                        Button { showBoard = true } label: { Label(L("Open the board here"), systemImage: "play.tv") }
                        ShareLink(item: url, subject: Text(party.name)) { Label(L("Share board link"), systemImage: "square.and.arrow.up") }
                        Button {
                            UIPasteboard.general.string = url
                            copied = true
                        } label: { Label(copied ? L("Link copied") : L("Copy board link"), systemImage: copied ? "checkmark" : "doc.on.doc") }
                    } header: { Text(L("or scan with the tablet")) } footer: {
                        Text(L("Apple TV or a TV with AirPlay: open the board here, then Control Center › Screen Mirroring. The board runs in the browser, so any TV or tablet works without the app."))
                    }
                }
                if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
            }
            .themedList()
            .navigationTitle(L("Show on TV"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Done")) { dismiss() } } }
            .fullScreenCover(isPresented: $showBoard) {
                if let s = party.boardUrl, let u = URL(string: s) { SafariView(url: u).ignoresSafeArea() }
            }
        }
    }

    private var host: String {
        (party.pairUrl ?? "").replacingOccurrences(of: "https://", with: "").replacingOccurrences(of: "http://", with: "")
    }

    private func step(_ n: Int, _ text: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: Theme.Space.s2) {
            Text("\(n)").font(.caption.weight(.bold)).foregroundStyle(Theme.onPrimary)
                .frame(width: 22, height: 22).background(Theme.primary, in: Circle())
            Text(text).font(.subheadline).foregroundStyle(Theme.ink)
        }
    }

    private func newCode() async {
        do {
            let p = try await api.newPairCode(party.id)
            party = p
            onUpdate(p)
            Haptics.tick()
        } catch { self.error = APIError.from(error).localizedDescription }
    }
}

/// A link as QR code with share and copy (party guest link).
struct LinkQRSheet: View {
    let title: String
    let url: String
    let shareMessage: String
    let footnote: String
    @Environment(\.dismiss) private var dismiss
    @State private var copied = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: Theme.Space.s4) {
                    if let qr = QRCode.image(url) {
                        Image(uiImage: qr).interpolation(.none).resizable().scaledToFit()
                            .frame(width: 240, height: 240)
                            .padding(Theme.Space.s3)
                            .background(Color.white, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
                            .accessibilityLabel(L("QR code of the guest link"))
                    }
                    Text(url).font(.caption.monospaced()).foregroundStyle(Theme.ink3).multilineTextAlignment(.center).textSelection(.enabled)
                    ShareLink(item: url, subject: Text(title), message: Text(shareMessage)) {
                        Label(L("Share"), systemImage: "square.and.arrow.up")
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    Button {
                        UIPasteboard.general.string = url
                        copied = true
                    } label: { Label(copied ? L("Link copied") : L("Copy"), systemImage: copied ? "checkmark" : "doc.on.doc") }
                        .buttonStyle(SecondaryButtonStyle())
                    Text(footnote).font(.caption).foregroundStyle(Theme.ink3).multilineTextAlignment(.center)
                    Text(L("Tip: print the QR code and stick it on the fridge.")).font(.caption).foregroundStyle(Theme.ink3).multilineTextAlignment(.center)
                }
                .padding(Theme.Space.s4)
            }
            .canvasBackground()
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Done")) { dismiss() } } }
        }
    }
}

struct SafariView: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> SFSafariViewController { SFSafariViewController(url: url) }
    func updateUIViewController(_ vc: SFSafariViewController, context: Context) {}
}

// MARK: - recap

/// After the party: what was ordered, what ran out → shopping list, save the menu for next time (web RecapSheet).
struct PartyRecapSheet: View {
    let api: APIClient
    let partyId: Int
    @Environment(\.dismiss) private var dismiss
    @State private var recap: PartyRecap?
    @State private var error: String?
    @State private var pick: Set<Int> = []
    @State private var templateName = ""
    @State private var saved = false
    @State private var toast: ToastMessage?

    var body: some View {
        NavigationStack {
            List {
                if let r = recap {
                    Section {
                        HStack(spacing: Theme.Space.s2) {
                            stat(r.totals.items ?? 0, L("items ordered"))
                            stat(r.totals.orders ?? 0, L("orders"))
                            stat(r.totals.guests ?? 0, L("phones & people"))
                        }
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
                    }
                    if let open = r.totals.open, open > 0 {
                        Section {
                            Label {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(open == 1 ? L("1 order is still open") : LF("%d orders are still open", open)).font(.subheadline.weight(.semibold))
                                    Text(L("Serve or decline them on the board.")).font(.caption).foregroundStyle(Theme.ink2)
                                }
                            } icon: { Image(systemName: "wineglass").foregroundStyle(Theme.warning) }
                        }
                    }
                    if r.items.isEmpty {
                        Section { Text(L("Nobody ordered anything this time.")).foregroundStyle(Theme.ink3) }
                    } else {
                        Section(L("What was ordered")) {
                            let top = Double(max(1, r.items.first?.qty ?? 1))
                            ForEach(Array(r.items.prefix(12).enumerated()), id: \.offset) { _, i in
                                VStack(alignment: .leading, spacing: 4) {
                                    HStack {
                                        Text(i.name).font(.subheadline)
                                        Spacer()
                                        Text("\(i.qty)").font(.subheadline.weight(.semibold)).monospacedDigit()
                                    }
                                    ProgressView(value: Double(i.qty), total: top).tint(Theme.primary)
                                        .accessibilityHidden(true)
                                }
                            }
                        }
                    }
                    let next = r.ranOut + r.runningLow
                    if !next.isEmpty {
                        Section {
                            ForEach(next) { x in
                                HStack(spacing: Theme.Space.s3) {
                                    ProductThumb(path: x.imagePath, api: api, size: 36)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(x.name)
                                        Text(x.onList == true ? L("already on the shopping list") : (x.total ?? 0) <= 0 ? L("ran out") : L("running low"))
                                            .font(.caption).foregroundStyle(Theme.ink3)
                                    }
                                    Spacer(minLength: 0)
                                    if x.onList != true {
                                        Toggle(x.name, isOn: Binding(get: { pick.contains(x.productId) }, set: { v in
                                            if v { pick.insert(x.productId) } else { pick.remove(x.productId) }
                                        }))
                                        .labelsHidden().tint(Theme.primary)
                                    }
                                }
                            }
                            Button { Task { await toShop() } } label: { Label(L("Put on the shopping list"), systemImage: "basket") }
                                .disabled(pick.isEmpty)
                        } header: { Text(L("For next time")) }
                    }
                    Section {
                        HStack {
                            TextField(L("Name"), text: $templateName)
                            Button(saved ? L("Saved") : L("Save")) { Task { await saveTemplate() } }
                                .buttonStyle(.bordered)
                                .disabled(saved || templateName.trimmingCharacters(in: .whitespaces).isEmpty)
                        }
                    } header: { Text(L("Save the menu for next time")) }
                } else if let error {
                    EmptyStateView(systemImage: "party.popper", title: L("Couldn’t load the recap"), message: error)
                        .listRowBackground(Color.clear)
                } else {
                    HStack { Spacer(); ProgressView(); Spacer() }
                }
            }
            .themedList()
            .navigationTitle(recap.map { LF("Recap: %@", $0.party.name) } ?? L("Recap"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Done")) { dismiss() } } }
            .toast($toast)
            .task { await load() }
        }
    }

    private func stat(_ n: Int, _ label: String) -> some View {
        VStack(spacing: 2) {
            Text("\(n)").font(.title2.weight(.bold)).monospacedDigit().foregroundStyle(Theme.ink)
            Text(label).font(.caption).foregroundStyle(Theme.ink3).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, minHeight: 72)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
        .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).stroke(Theme.line, lineWidth: 1))
        .accessibilityElement(children: .combine)
    }

    private func load() async {
        do {
            let r = try await api.partyRecap(partyId)
            recap = r
            pick = Set(r.ranOut.filter { $0.onList != true }.map(\.productId))
            templateName = r.party.name
        } catch { self.error = APIError.from(error).localizedDescription }
    }

    private func toShop() async {
        do {
            let n = try await api.partyRecapToShopping(partyId, productIds: Array(pick))
            toast = ToastMessage(text: n == 1 ? L("1 thing is on the shopping list") : LF("%d things are on the shopping list", n))
            Haptics.success()
            await load()
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }

    private func saveTemplate() async {
        do {
            try await api.savePartyTemplate(partyId: partyId, name: templateName.trimmingCharacters(in: .whitespaces))
            saved = true
            toast = ToastMessage(text: L("Saved – it’s there next time you start a party."))
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }
}

// MARK: - kitchen board

/// The host's live board for the party (web KitchenBoard): New → In progress → Ready. Tap a card for the next step,
/// hold it to decline. Cards warm up after 5 and 10 minutes. The screen stays on while it's open.
struct PartyKitchenBoard: View {
    let store: ServerStore
    let party: PartyInfo
    @Environment(\.dismiss) private var dismiss
    @Environment(\.horizontalSizeClass) private var sizeClass
    @AppStorage("party.board.sound") private var sound = true
    @State private var orders: [BarOrder] = []
    @State private var loaded = false
    @State private var column = "new"
    @State private var seenNew: Set<Int>?
    @State private var busy: Int?
    @State private var declining: BarOrder?
    @State private var toast: ToastMessage?

    private struct BoardColumn: Identifiable { let key: String; let title: String; var id: String { key } }
    private let columns = [BoardColumn(key: "new", title: L("New")), BoardColumn(key: "accepted", title: L("In progress")),
                           BoardColumn(key: "done", title: L("Ready"))]

    var body: some View {
        NavigationStack {
            TimelineView(.periodic(from: .now, by: 30)) { ctx in
                Group {
                    if sizeClass == .regular {
                        HStack(alignment: .top, spacing: Theme.Space.s3) {
                            ForEach(columns) { c in
                                VStack(alignment: .leading, spacing: Theme.Space.s2) {
                                    columnHead(c.key, c.title)
                                    ScrollView { cards(c.key, now: ctx.date) }
                                }
                                .frame(maxWidth: .infinity)
                            }
                        }
                        .padding(Theme.Space.s4)
                    } else {
                        VStack(spacing: Theme.Space.s3) {
                            Picker(L("Column"), selection: $column) {
                                ForEach(columns) { c in Text("\(c.title) \(list(c.key).count)").tag(c.key) }
                            }
                            .pickerStyle(.segmented)
                            .padding(.horizontal, Theme.Space.s4)
                            ScrollView { cards(column, now: ctx.date).padding(.horizontal, Theme.Space.s4) }
                        }
                        .padding(.top, Theme.Space.s2)
                    }
                }
            }
            .canvasBackground()
            .navigationTitle(party.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Close")) { dismiss() } }
                ToolbarItem(placement: .principal) {
                    VStack(spacing: 0) {
                        Text(party.name).font(.headline)
                        Text(LF("%d open · %d served", orders.filter(\.isOpen).count, orders.filter { $0.status == "done" }.count))
                            .font(.caption).foregroundStyle(Theme.ink3)
                    }
                    .accessibilityElement(children: .combine)
                }
                ToolbarItem(placement: .primaryAction) {
                    Button { sound.toggle() } label: { Image(systemName: sound ? "bell" : "bell.slash") }
                        .accessibilityLabel(sound ? L("Sound off") : L("Sound on"))
                }
            }
            .motion(value: orders.map { "\($0.id):\($0.status)" })
            .task(id: store.revision("orders")) { await load() }
            .task {
                while !Task.isCancelled {
                    try? await Task.sleep(nanoseconds: 15_000_000_000)
                    if !Task.isCancelled { await load() }
                }
            }
            .onAppear { UIApplication.shared.isIdleTimerDisabled = true }
            .onDisappear { UIApplication.shared.isIdleTimerDisabled = false }
            .confirmationDialog(L("Decline this order?"), isPresented: Binding(get: { declining != nil }, set: { if !$0 { declining = nil } }),
                                titleVisibility: .visible, presenting: declining) { o in
                Button(L("Decline"), role: .destructive) { Task { await move(o, "declined") } }
                Button(L("Cancel"), role: .cancel) {}
            }
            .toast($toast)
        }
    }

    private func list(_ key: String) -> [BarOrder] {
        let l = orders.filter { $0.status == key }
        return key == "done" ? Array(l.sorted { ($0.updatedAt ?? "") > ($1.updatedAt ?? "") }.prefix(12)) : l.sorted { $0.id < $1.id }
    }

    private func columnHead(_ key: String, _ title: String) -> some View {
        HStack {
            Text(title).font(.headline).foregroundStyle(Theme.ink)
            Text("\(list(key).count)").font(.subheadline.weight(.semibold)).monospacedDigit()
                .padding(.horizontal, 8).padding(.vertical, 2)
                .background(Theme.surface2, in: Capsule())
            Spacer()
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private func cards(_ key: String, now: Date) -> some View {
        let l = list(key)
        LazyVStack(spacing: Theme.Space.s2) {
            if !loaded {
                ProgressView().padding(.top, 40)
            } else if l.isEmpty {
                Text(key == "new" ? L("No new orders") : "—").font(.subheadline).foregroundStyle(Theme.ink3)
                    .frame(maxWidth: .infinity, minHeight: 80)
            }
            ForEach(l) { o in card(o, key: key, now: now) }
        }
        .padding(.bottom, Theme.Space.s6)
    }

    private func minutes(_ s: String?, now: Date) -> Int {
        guard let d = ServerDate.parse(s) else { return 0 }
        return max(0, Int(now.timeIntervalSince(d) / 60))
    }

    private func card(_ o: BarOrder, key: String, now: Date) -> some View {
        let age = minutes(key == "done" ? o.updatedAt : o.createdAt, now: now)
        let heat: Color = key == "done" ? Theme.line : age >= 10 ? Theme.clay : age >= 5 ? Theme.mustard : Theme.line
        let next: String? = o.status == "new" ? "accepted" : o.status == "accepted" ? "done" : nil
        return Button {
            if let next { Task { await move(o, next) } }
        } label: {
            VStack(alignment: .leading, spacing: Theme.Space.s2) {
                HStack(alignment: .firstTextBaseline) {
                    Text((o.guestName?.isEmpty == false ? o.guestName! : LF("No. %d", o.id))
                         + (o.userId != nil ? " · " + L("from the sofa") : ""))
                        .font(.headline).foregroundStyle(Theme.ink)
                    Spacer(minLength: 0)
                    Text(key == "done" ? LF("ready %d min", age) : LF("%d min", age))
                        .font(.caption.weight(.semibold)).monospacedDigit()
                        .foregroundStyle(heat == Theme.line ? Theme.ink3 : heat)
                }
                ForEach(Array(o.lines.enumerated()), id: \.offset) { _, l in
                    (Text("\(l.qty)× ").bold() + Text(l.name)
                        + Text((l.options ?? []).isEmpty ? "" : " · " + (l.options ?? []).joined(separator: ", ")).foregroundColor(Theme.ink3)
                        + Text((l.note ?? "").isEmpty ? "" : " „\(l.note ?? "")“").foregroundColor(Theme.clay))
                        .font(.body).foregroundStyle(Theme.ink)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let n = o.note, !n.isEmpty {
                    Text("„\(n)“").font(.subheadline).foregroundStyle(Theme.ink2)
                }
                if let next {
                    Text(next == "accepted" ? L("Tap: start") : L("Tap: ready")).font(.caption).foregroundStyle(Theme.primaryText)
                }
            }
            .padding(Theme.Space.s3)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
            .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).stroke(heat, lineWidth: heat == Theme.line ? 1 : 2.5))
            .opacity(busy == o.id ? 0.5 : 1)
            .contentShape(RoundedRectangle(cornerRadius: Theme.Radius.lg))
        }
        .buttonStyle(.plain)
        .disabled(busy == o.id || next == nil)
        .contextMenu {
            if o.status != "done" {
                Button(role: .destructive) { declining = o } label: { Label(L("Decline"), systemImage: "xmark") }
            }
        }
        .accessibilityHint(next == "accepted" ? L("Tap: start") : next == "done" ? L("Tap: ready") : "")
        .accessibilityAction(named: L("Decline")) { if o.status != "done" { declining = o } }
    }

    private func load() async {
        guard let all = try? await store.api.barOrders() else { return }
        let mine = all.filter { $0.partyId == party.id && $0.status != "declined" }
        let fresh = Set(mine.filter { $0.status == "new" }.map(\.id))
        if let seen = seenNew, !fresh.subtracting(seen).isEmpty {
            UINotificationFeedbackGenerator().notificationOccurred(.warning)
            if sound { AudioServicesPlaySystemSound(1007) }
        }
        seenNew = (seenNew ?? []).union(fresh)
        orders = mine
        loaded = true
    }

    private func move(_ o: BarOrder, _ status: String) async {
        busy = o.id
        defer { busy = nil }
        do {
            try await store.api.answerTreat(o.id, status: status)
            if status == "done" { Haptics.success() } else { Haptics.tick() }
            store.touch("orders", "stock")
            await load()
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }
}
