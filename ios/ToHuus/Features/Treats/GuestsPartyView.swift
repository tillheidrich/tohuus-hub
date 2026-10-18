import AudioToolbox
import SwiftUI

/// "Gäste & Party" (web: /bar – Bar.tsx with Party.tsx `PartyCard`): the party on top (start, run, end, recap),
/// then three tabs like the web – the board with everything asked for at home, by guests and at the party; the guest
/// links; and the bar menu switches with the way into the full menu editor.
/// Live like the web: the board refreshes on the server's `orders` change events (SSE via ServerStore) and, calmly,
/// every 30 s as a fallback. A new order gives a haptic tap and – if switched on – a short sound.
struct GuestsPartyView: View {
    let store: ServerStore
    @Environment(AppModel.self) private var app

    enum Tab: String, Hashable { case board, links, menu }
    enum Filter: String, Hashable, CaseIterable { case all, home, guests, party }

    @State private var tab: Tab = .board
    @State private var filter: Filter = .all
    @State private var party: PartyInfo?
    @State private var partyLoaded = false
    @State private var recent: [RecentParty] = []
    @State private var orders: [BarOrder]?
    @State private var seenNew: Set<Int>?
    @State private var error: String?
    @State private var toast: ToastMessage?
    @AppStorage("party.board.sound") private var sound = true

    // party
    @State private var showStart = false
    @State private var recap: RecapKey?
    @State private var partySheet: PartySheet?
    @State private var confirmEnd = false
    @State private var showKitchen = false

    // links
    @State private var links: [GuestLink]?
    @State private var creating: GuestLinkDraft?
    @State private var shownLink: GuestLinksView.ShownLink?
    @State private var rotating: GuestLink?

    // bar menu
    @State private var products: [BarProduct]?
    @State private var productQuery = ""
    /// receipt printers (self-hosted servers that have one) – "print as ticket" on an order, like the web's BonButton
    @State private var printers: [PrintInfoLite.Printer] = []

    struct RecapKey: Identifiable { let id: Int }
    enum PartySheet: String, Identifiable { case tv, qr, menu; var id: String { rawValue } }

    private var api: APIClient { store.api }

    /// an answered order or a new one moves in place
    private var motionKey: [String] {
        var k: [String] = (orders ?? []).map { "\($0.id):\($0.status)" }
        if let p = party { k.append("p\(p.id)\(p.status)\(p.openOrders ?? 0)") }
        return k
    }
    private var canEdit: Bool { !app.isGuest }
    /// party mode: its own switch in „Was nutzt ihr?“, off for the start (docs/party-modus.md). Off: no party card,
    /// no „Party“ filter, the screen is just „Gäste“. Guest links, the board and the menu stay.
    private var partyOn: Bool { app.modules["party"] == true }

    var body: some View {
        List {
            if partyOn { partySection }
            Section {
                Picker(L("Show"), selection: $tab) {
                    Text(L("Board")).tag(Tab.board)
                    Text(L("Guest links")).tag(Tab.links)
                    Text(L("Menu")).tag(Tab.menu)
                }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
            }
            if let error { Section { ErrorBanner(message: error) { Task { await loadAll() } } } }
            switch tab {
            case .board: boardSections
            case .links: linkSections
            case .menu: menuSections
            }
        }
        .themedList()
        .navigationTitle(partyOn ? L("Guests & party") : L("Guests"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { sound.toggle() } label: { Image(systemName: sound ? "bell" : "bell.slash") }
                    .accessibilityLabel(L("Sound for new orders"))
                    .accessibilityValue(sound ? L("Sound on") : L("Sound off"))
            }
            ToolbarItem(placement: .primaryAction) {
                if canEdit {
                    NavigationLink { MenuEditorView(store: store) } label: { Image(systemName: "pencil") }
                        .accessibilityLabel(L("Edit menu"))
                }
            }
        }
        .onAppear { app.screenContext = "guests" }
        .onDisappear { if app.screenContext == "guests" { app.screenContext = nil } }
        // live: the server says "orders changed" → reload; reconnects count too
        .task(id: store.revision("orders") + store.revision("products")) { await loadAll() }
        .task {
            // calm fallback while the screen is open (the SSE stream may be down)
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 30_000_000_000)
                if !Task.isCancelled { await loadAll() }
            }
        }
        .task(id: tab) { await loadTab() }
        .task { if let info = try? await api.printInfoLite() { printers = info.printers } }
        .refreshable { await loadAll(); await loadTab() }
        .motion(value: motionKey)
        .sheet(isPresented: $showStart) {
            StartPartySheet(store: store) { p in
                party = p
                toast = ToastMessage(text: L("The party is on!"))
                Haptics.success()
                store.touch("orders")
            }
        }
        .sheet(item: $recap) { k in PartyRecapSheet(api: api, partyId: k.id) }
        .sheet(item: $partySheet) { s in
            if let p = party {
                switch s {
                case .tv: PartyTVSheet(api: api, party: p) { party = $0 }
                case .qr:
                    LinkQRSheet(title: p.name, url: p.guestUrl ?? "", shareMessage: L("Order something – drinks, ice cream, snacks:"),
                                footnote: L("The link stops working when the party ends."))
                case .menu:
                    PartyMenuSheet(store: store, party: p) { party = $0; store.touch("orders") }
                }
            }
        }
        .fullScreenCover(isPresented: $showKitchen) {
            if let p = party { PartyKitchenBoard(store: store, party: p) }
        }
        .confirmationDialog(party.map { LF("End “%@” now? The guest link stops working.", $0.name) } ?? "",
                            isPresented: $confirmEnd, titleVisibility: .visible) {
            Button(L("End party"), role: .destructive) { Task { await endParty() } }
            Button(L("Cancel"), role: .cancel) {}
        }
        .sheet(item: $creating) { d in
            GuestLinkForm(api: api, draft: d) { name, r in
                shownLink = GuestLinksView.ShownLink(name: name, url: r.url, expiresAt: nil)
                Task { await loadLinks() }
            }
        }
        .sheet(item: $shownLink) { s in GuestLinkShareSheet(name: s.name, url: s.url) }
        .confirmationDialog(rotating.map { LF("The current link for “%@” stops working. Create a new one?", $0.name) } ?? "",
                            isPresented: Binding(get: { rotating != nil }, set: { if !$0 { rotating = nil } }),
                            titleVisibility: .visible, presenting: rotating) { g in
            Button(L("New link")) { Task { await rotate(g) } }
            Button(L("Cancel"), role: .cancel) {}
        }
        .toast($toast)
        .task {
            #if DEBUG
            // simulator checks: -debugParty start | tv | qr | menu | kitchen | links | barmenu
            switch UserDefaults.standard.string(forKey: "debugParty") {
            case "start": showStart = true
            case "links": tab = .links
            case "barmenu": tab = .menu
            case "tv", "qr", "menu", "kitchen":
                try? await Task.sleep(nanoseconds: 1_500_000_000)
                let k = UserDefaults.standard.string(forKey: "debugParty") ?? ""
                if party != nil { if k == "kitchen" { showKitchen = true } else { partySheet = PartySheet(rawValue: k) } }
            default: break
            }
            #endif
        }
    }

    // MARK: - party card

    @ViewBuilder
    private var partySection: some View {
        Section {
            if !partyLoaded {
                HStack { Spacer(); ProgressView(); Spacer() }.frame(minHeight: 100)
            } else if let p = party {
                liveParty(p)
            } else {
                startCard
            }
        }
    }

    private var lastEnded: RecentParty? {
        recent.first { r in
            guard r.status == "ended", let d = ServerDate.parse(r.endedAt) else { return false }
            return Date().timeIntervalSince(d) < 7 * 86_400
        }
    }

    private var startCard: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s3) {
            HStack(alignment: .top, spacing: Theme.Space.s3) {
                Image(systemName: "party.popper")
                    .font(.system(size: 26, weight: .medium))
                    .foregroundStyle(Theme.clay)
                    .frame(width: 52, height: 52)
                    .background(Theme.clay.opacity(0.14), in: Circle())
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    Text(L("Party mode").uppercased()).font(.caption.weight(.semibold)).tracking(0.6).foregroundStyle(Theme.ink3)
                    Text(L("Having people over?")).font(.headline).foregroundStyle(Theme.ink)
                    Text(L("Guests scan a QR code, order from your party menu and pick up at the counter. The TV shows what’s being made. It ends by itself."))
                        .font(.subheadline).foregroundStyle(Theme.ink2).fixedSize(horizontal: false, vertical: true)
                }
            }
            if canEdit {
                VStack(spacing: Theme.Space.s2) { startButton; recapButton }
            }
        }
        .padding(.vertical, Theme.Space.s2)
    }

    // own styles instead of .borderedProminent + Label: icon and text centred as one block (Till, 18 Oct 2026:
    // „Party starten“ sat off centre in the green button)
    private var startButton: some View {
        Button { showStart = true } label: { ButtonLabel(L("Start a party"), systemImage: "party.popper") }
            .buttonStyle(PrimaryButtonStyle())
    }

    @ViewBuilder
    private var recapButton: some View {
        if let last = lastEnded {
            Button { recap = RecapKey(id: last.id) } label: { ButtonLabel(LF("Recap: %@", last.name)) }
                .buttonStyle(SecondaryButtonStyle())
        }
    }

    private func liveParty(_ p: PartyInfo) -> some View {
        VStack(alignment: .leading, spacing: Theme.Space.s3) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Circle().fill(Theme.clay).frame(width: 8, height: 8).accessibilityHidden(true)
                        Text(L("Party is on").uppercased()).font(.caption.weight(.semibold)).tracking(0.6).foregroundStyle(Theme.clay)
                    }
                    Text(p.name).font(.title3.weight(.semibold)).foregroundStyle(Theme.ink)
                    if !p.endsText.isEmpty {
                        Label(p.endsText, systemImage: "clock").font(.caption).foregroundStyle(Theme.ink2)
                    }
                }
                Spacer(minLength: 0)
                Button { showKitchen = true } label: {
                    VStack(spacing: 0) {
                        Text("\(p.openOrders ?? 0)").font(.title.weight(.bold)).monospacedDigit()
                        Text(L("open")).font(.caption)
                    }
                    .foregroundStyle(Theme.onPrimary)
                    .frame(minWidth: 64, minHeight: 64)
                    .background(Theme.primary, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(LF("%d open – open the kitchen board", p.openOrders ?? 0))
            }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: Theme.Space.s2)], spacing: Theme.Space.s2) {
                partyAction(L("Kitchen board"), L("Work the orders here"), "frying.pan") { showKitchen = true }
                partyAction(L("Show on TV"), L("Code or QR for the big screen"), "tv") { partySheet = .tv }
                if p.guestUrl != nil {
                    partyAction(L("Guest QR"), L("Share the order link"), "qrcode") { partySheet = .qr }
                }
                if canEdit {
                    partyAction(L("Party menu"), p.menu.count == 1 ? L("1 item") : LF("%d items", p.menu.count), "wineglass") { partySheet = .menu }
                }
            }
            if canEdit {
                Toggle(isOn: Binding(get: { p.showNames ?? false }, set: { v in Task { await setNames(p, v) } })) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(L("Guest names on the TV")).font(.subheadline)
                        Text(L("Off: the TV only shows order numbers.")).font(.caption).foregroundStyle(Theme.ink3)
                    }
                }
                .tint(Theme.primary)
                PickupHintField(party: p) { v in await setPickupHint(p, v) }
                ViewThatFits(in: .horizontal) {
                    HStack {
                        Button { Task { await extend(p) } } label: { ButtonLabel(L("1 hour longer"), systemImage: "plus") }
                            .buttonStyle(.bordered)
                        Spacer(minLength: Theme.Space.s2)
                        Button(role: .destructive) { confirmEnd = true } label: { ButtonLabel(L("End party"), systemImage: "stop.fill") }
                            .buttonStyle(.bordered)
                    }
                    VStack(spacing: Theme.Space.s2) {
                        Button { Task { await extend(p) } } label: { ButtonLabel(L("1 hour longer"), systemImage: "plus", wide: true) }
                            .buttonStyle(.bordered)
                        Button(role: .destructive) { confirmEnd = true } label: { ButtonLabel(L("End party"), systemImage: "stop.fill", wide: true) }
                            .buttonStyle(.bordered)
                    }
                }
                .controlSize(.regular)
            }
        }
        .padding(.vertical, Theme.Space.s2)
    }

    private func partyAction(_ title: String, _ sub: String, _ icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 4) {
                Image(systemName: icon).font(.title3).foregroundStyle(Theme.primaryText)
                Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                Text(sub).font(.caption).foregroundStyle(Theme.ink3).lineLimit(2)
            }
            .padding(Theme.Space.s3)
            .frame(maxWidth: .infinity, minHeight: 88, alignment: .topLeading)
            .background(Theme.surface2, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
            .contentShape(RoundedRectangle(cornerRadius: Theme.Radius.base))
        }
        .buttonStyle(.plain)
    }

    // MARK: - board

    private var shownOrders: [BarOrder] {
        (orders ?? []).filter { o in
            switch filter {
            case .all: return true
            case .home: return o.partyId == nil && o.guestLinkId == nil
            case .guests: return o.guestLinkId != nil && o.partyId == nil
            case .party: return o.partyId != nil
            }
        }
    }

    @ViewBuilder
    private var boardSections: some View {
        Section {
            Picker(L("Show"), selection: $filter) {
                Text(L("All")).tag(Filter.all)
                Text(L("At home")).tag(Filter.home)
                Text(L("Guests")).tag(Filter.guests)
                if partyOn { Text(L("Party")).tag(Filter.party) }
            }
            .pickerStyle(.segmented)
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 0))
        }
        if orders == nil {
            Section { HStack { Spacer(); ProgressView(); Spacer() } }
        } else if shownOrders.isEmpty {
            Section {
                EmptyStateView(systemImage: "wineglass", title: L("Nothing open right now"), message: emptyText)
                    .listRowBackground(Color.clear)
            }
        } else {
            let open = shownOrders.filter(\.isOpen)
            let rest = shownOrders.filter { !$0.isOpen }
            if !open.isEmpty {
                Section {
                    ForEach(open) { o in BoardOrderRow(order: o, api: api, printers: printers, onPrint: { p in await printTicket(o, p) }) { s in await set(o, s) } }
                } header: { Text(LF("Open (%d)", open.count)) }
            }
            if !rest.isEmpty {
                Section {
                    ForEach(rest) { o in BoardOrderRow(order: o, api: api, printers: printers, onPrint: { p in await printTicket(o, p) }) { s in await set(o, s) } }
                } header: { Text(L("Earlier today")) } footer: {
                    Text(L("“Served” automatically deducts counted items from stock."))
                }
            }
        }
    }

    private var emptyText: String {
        switch filter {
        case .guests: return L("Nobody has asked for anything yet.")
        case .party: return L("No party orders yet. Start a party above – guests scan the QR code and pick up at the counter.")
        default: return partyOn ? L("Wishes from home, guests and the party show up here.") : L("Wishes from home and from guests show up here.")
        }
    }

    // MARK: - guest links

    @ViewBuilder
    private var linkSections: some View {
        if canEdit {
            Section {
                Button { creating = .babysitter } label: { Label(L("Babysitter"), systemImage: "figure.and.child.holdinghands") }
                Button { creating = .visitors } label: { Label(L("Visitors"), systemImage: "wineglass") }
                Button { creating = .grandparents } label: { Label(L("Grandparents"), systemImage: "heart") }
            } header: { Text(L("New guest link")) } footer: {
                Text(L("Guests don’t need an account. They only see what you share – never quantities, purchases or other rooms."))
            }
        }
        if let links {
            if links.isEmpty {
                Section {
                    EmptyStateView(systemImage: "link", title: L("No guest links yet"), message: L("Create one above – for an evening, a weekend or the holidays."))
                        .listRowBackground(Color.clear)
                }
            } else {
                Section {
                    ForEach(links) { g in
                        GuestLinkRow(link: g, onRotate: { rotating = g }, onRevoke: { Task { await revoke(g) } })
                    }
                } header: { Text(L("Guest links")) } footer: {
                    Text(L("Links are stored safely: the address is shown only once. Tap the QR code for a new one."))
                }
            }
        } else {
            Section { HStack { Spacer(); ProgressView(); Spacer() } }
        }
    }

    // MARK: - bar menu (switches)

    @ViewBuilder
    private var menuSections: some View {
        Section {
            if canEdit {
                NavigationLink { MenuEditorView(store: store) } label: {
                    Label(L("Groups, pictures & options"), systemImage: "slider.horizontal.3")
                }
            }
        } footer: {
            Text(L("Guests see whatever is switched on here – counted items only while there’s some left."))
        }
        Section {
            HStack {
                Image(systemName: "magnifyingglass").foregroundStyle(Theme.ink3)
                TextField(L("Search"), text: $productQuery).autocorrectionDisabled()
            }
            if let products {
                let q = productQuery.trimmingCharacters(in: .whitespaces).lowercased()
                let list = products
                    .filter { q.isEmpty || "\($0.name) \($0.brand ?? "")".lowercased().contains(q) }
                    .sorted { ($0.isOrderable ? 0 : 1, $0.name.lowercased()) < ($1.isOrderable ? 0 : 1, $1.name.lowercased()) }
                ForEach(list.prefix(q.isEmpty ? 200 : 80)) { p in
                    Toggle(isOn: Binding(get: { p.isOrderable }, set: { v in Task { await toggle(p, v) } })) {
                        HStack(spacing: Theme.Space.s3) {
                            ProductThumb(path: p.imagePath, api: api, size: 40)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(p.name).foregroundStyle(Theme.ink)
                                Text([p.orderGroup, p.amountText].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                                    .font(.caption).foregroundStyle(Theme.ink3)
                            }
                        }
                    }
                    .tint(Theme.primary)
                    .disabled(!canEdit)
                }
            } else {
                HStack { Spacer(); ProgressView(); Spacer() }
            }
        }
    }

    // MARK: - loading

    private func loadAll() async {
        async let pc = api.currentParty()
        async let rp = api.recentParties()
        async let os = api.barOrders()
        do {
            let o = try await os
            notifyNew(o)
            orders = o
            error = nil
        } catch {
            if orders == nil { self.error = APIError.from(error).localizedDescription }
        }
        // an error keeps what we had; a real "no party" answer clears it
        do { party = try await pc } catch {}
        partyLoaded = true
        recent = (try? await rp) ?? recent
        if tab != .board { await loadTab() }
    }

    private func loadTab() async {
        switch tab {
        case .board: break
        case .links: await loadLinks()
        case .menu: products = (try? await api.barProducts()) ?? products
        }
    }

    private func loadLinks() async {
        do { links = try await api.guestLinks() }
        catch { if links == nil { links = [] }; toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }

    /// a haptic (and, if on, a short sound) when a new order arrives while the board is open
    private func notifyNew(_ list: [BarOrder]) {
        let fresh = Set(list.filter { $0.status == "new" }.map(\.id))
        defer { seenNew = (seenNew ?? []).union(fresh) }
        guard let seen = seenNew, !fresh.subtracting(seen).isEmpty else { return }
        UINotificationFeedbackGenerator().notificationOccurred(.warning)
        if sound { AudioServicesPlaySystemSound(1007) }
        if let o = list.first(where: { fresh.subtracting(seen).contains($0.id) }) {
            toast = ToastMessage(text: LF("New: %@", [o.guestName, o.lines.first?.name].compactMap { $0 }.joined(separator: " · ")))
        }
    }

    // MARK: - actions

    private func set(_ o: BarOrder, _ status: String) async {
        do {
            try await api.answerTreat(o.id, status: status)
            if status == "done" || status == "accepted" { Haptics.success() } else { Haptics.tick() }
            store.touch("orders", "stock")
            await loadAll()
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }

    private func printTicket(_ o: BarOrder, _ p: PrintInfoLite.Printer) async {
        do {
            try await api.printTicket(type: "order", id: o.id, printerId: p.id)
            Haptics.success()
            toast = ToastMessage(text: LF("Sent to %@", p.name))
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }

    private func setNames(_ p: PartyInfo, _ v: Bool) async {
        do { party = try await api.updateParty(p.id, showNames: v) }
        catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }

    private func setPickupHint(_ p: PartyInfo, _ v: String) async {
        do { party = try await api.updateParty(p.id, pickupHint: v) }
        catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }

    private func extend(_ p: PartyInfo) async {
        do {
            party = try await api.extendParty(p.id, minutes: 60)
            toast = ToastMessage(text: L("One more hour"))
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }

    private func endParty() async {
        guard let p = party else { return }
        do {
            _ = try await api.endParty(p.id)
            party = nil
            Haptics.success()
            store.touch("orders")
            recap = RecapKey(id: p.id)
            await loadAll()
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }

    private func toggle(_ p: BarProduct, _ on: Bool) async {
        if let i = products?.firstIndex(where: { $0.id == p.id }) { products?[i].orderable = on }
        do {
            try await api.setOrderable(p.id, on: on, group: p.orderGroup ?? p.defaultGroup)
            Haptics.tick()
            store.touch("products")
        } catch {
            if let i = products?.firstIndex(where: { $0.id == p.id }) { products?[i].orderable = !on }
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
        }
    }

    private func rotate(_ g: GuestLink) async {
        do {
            let r = try await api.rotateGuestLink(g.id)
            shownLink = GuestLinksView.ShownLink(name: g.name, url: r.url, expiresAt: g.expiresAt)
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }

    private func revoke(_ g: GuestLink) async {
        do {
            try await api.revokeGuestLink(g.id)
            links?.removeAll { $0.id == g.id }
            toast = ToastMessage(text: LF("“%@” no longer works.", g.name))
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }
}

/// Till, 18 Oct 2026: „Abholen an der Theke“ was fixed text – every party is different. The host writes the line under
/// „Scan & order“ on the TV board; empty = the neutral default (web: Party.tsx PickupHintField).
private struct PickupHintField: View {
    let party: PartyInfo
    let save: (String) async -> Void
    @State private var text = ""
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(L("Hint under “Scan & order”")).font(.subheadline)
            TextField(party.pickupHintDefault ?? L("We’ll let you know when it’s ready"), text: $text)
                .textFieldStyle(.roundedBorder)
                .submitLabel(.done)
                .focused($focused)
                .onSubmit { commit() }
                .onChange(of: focused) { _, f in if !f { commit() } }
                .onChange(of: text) { _, v in if v.count > 80 { text = String(v.prefix(80)) } }
            Text(L("Shown on the TV next to the QR code. E.g. “Grab it at the bar” or “We’ll bring it to you”."))
                .font(.caption).foregroundStyle(Theme.ink3).fixedSize(horizontal: false, vertical: true)
        }
        .task(id: party.id) { text = party.pickupHint ?? "" }
    }

    private func commit() {
        let v = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard v != (party.pickupHint ?? "") else { return }
        Task { await save(v) }
    }
}

/// One order on the board: who, from where, what, the note – and the next step (web Bar.tsx `Orders`).
struct BoardOrderRow: View {
    let order: BarOrder
    let api: APIClient
    var printers: [PrintInfoLite.Printer] = []
    var onPrint: ((PrintInfoLite.Printer) async -> Void)?
    let set: (String) async -> Void
    @State private var busy = false
    @State private var confirmDecline = false

    var body: some View {
        let o = order
        VStack(alignment: .leading, spacing: Theme.Space.s2) {
            HStack(alignment: .top, spacing: Theme.Space.s3) {
                PersonAvatar(name: o.guestName ?? "?", key: o.userId.map { "u\($0)" }, size: 36, api: api)
                VStack(alignment: .leading, spacing: 2) {
                    Text(o.guestName ?? L("Guest")).font(.headline).foregroundStyle(Theme.ink)
                    Text([o.origin, o.forUserId != nil ? o.forName.map { LF("asked %@", $0) } : nil, ServerDate.relative(o.createdAt)]
                        .compactMap { $0 }.joined(separator: " · "))
                        .font(.caption).foregroundStyle(Theme.ink3)
                    if let by = o.byLine { Text(by).font(.caption.weight(.semibold)).foregroundStyle(Theme.ink2) }
                }
                Spacer(minLength: 0)
                Text(o.badge)
                    .font(.caption.weight(.semibold))
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .foregroundStyle(badgeInk)
                    .background(badgeBg, in: Capsule())
            }
            VStack(alignment: .leading, spacing: 3) {
                ForEach(Array(o.lines.enumerated()), id: \.offset) { _, l in
                    (Text("\(l.qty)× ").bold() + Text(l.name)
                        + Text((l.options ?? []).isEmpty ? "" : " · " + (l.options ?? []).joined(separator: ", ")).foregroundColor(Theme.ink3)
                        + Text((l.note ?? "").isEmpty ? "" : " · „\(l.note ?? "")“").foregroundColor(Theme.clay))
                        .font(.subheadline).foregroundStyle(Theme.ink)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            if let n = o.note, !n.isEmpty {
                Text("„\(n)“").font(.subheadline).foregroundStyle(Theme.ink2)
                    .padding(.horizontal, 10).padding(.vertical, 6)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.surface2, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
            }
            if o.isOpen {
                // one line while all three fit; otherwise the two forward steps side by side and „Geht gerade nicht“
                // below, then all stacked – the labels are never squeezed or hyphenated (Till, 18 Oct 2026)
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: Theme.Space.s2) {
                        declineButton(wide: false)
                        Spacer(minLength: Theme.Space.s2)
                        forwardButtons(wide: false)
                    }
                    VStack(spacing: Theme.Space.s2) {
                        HStack(spacing: Theme.Space.s2) { forwardButtons(wide: true) }
                        declineButton(wide: true)
                    }
                    VStack(spacing: Theme.Space.s2) {
                        forwardButtons(wide: true)
                        declineButton(wide: true)
                    }
                }
                .controlSize(.regular)
                .disabled(busy)
            }
        }
        .padding(.vertical, Theme.Space.s1)
        .opacity(o.status == "declined" ? 0.6 : 1)
        .swipeActions(edge: .trailing) {
            if o.isOpen {
                Button { run("done") } label: { Label(o.isServed ? L("Served") : L("Brought it"), systemImage: "checkmark") }
                    .tint(Theme.primary)
            }
        }
        .swipeActions(edge: .leading) {
            if o.status == "new" {
                Button { run("accepted") } label: { Label(o.isServed ? L("On it") : L("I’ll bring it"), systemImage: "hand.raised") }
                    .tint(Theme.info)
            }
        }
        .confirmationDialog(L("Decline this order?"), isPresented: $confirmDecline, titleVisibility: .visible) {
            Button(o.isServed ? L("Decline") : L("Can’t right now"), role: .destructive) { run("declined") }
            Button(L("Cancel"), role: .cancel) {}
        }
        .contextMenu {
            if o.isOpen {
                Button { run("done") } label: { Label(o.isServed ? L("Served") : L("Brought it"), systemImage: "checkmark") }
                if o.status == "new" {
                    Button { run("accepted") } label: { Label(o.isServed ? L("On it") : L("I’ll bring it"), systemImage: "hand.raised") }
                }
            }
            if let onPrint, !printers.isEmpty {
                Section(L("Receipt printer")) {
                    ForEach(printers) { p in
                        Button { Task { await onPrint(p) } } label: { Label(p.name, systemImage: "scroll") }
                    }
                }
            }
            if o.isOpen {
                Button(role: .destructive) { confirmDecline = true } label: { Label(o.isServed ? L("Decline") : L("Can’t right now"), systemImage: "xmark") }
            }
        }
        .accessibilityElement(children: .contain)
    }

    private func declineButton(wide: Bool) -> some View {
        Button(role: .destructive) { confirmDecline = true } label: {
            ButtonLabel(order.isServed ? L("Decline") : L("Can’t right now"), systemImage: "xmark", wide: wide)
        }
        .buttonStyle(.bordered)
    }

    @ViewBuilder
    private func forwardButtons(wide: Bool) -> some View {
        if order.status == "new" {
            Button { run("accepted") } label: { ButtonLabel(order.isServed ? L("On it") : L("I’ll bring it"), wide: wide) }
                .buttonStyle(.bordered)
        }
        Button { run("done") } label: { ButtonLabel(order.isServed ? L("Served") : L("Brought it"), systemImage: "checkmark", wide: wide) }
            .buttonStyle(.borderedProminent).tint(Theme.primary)
    }

    private var badgeInk: Color {
        switch order.status {
        case "new": return Theme.warning
        case "accepted": return Theme.info
        case "done": return Theme.primaryText
        default: return Theme.ink3
        }
    }

    private var badgeBg: Color {
        switch order.status {
        case "new": return Theme.warningSoft
        case "accepted": return Theme.infoSoft
        case "done": return Theme.primarySoft
        default: return Theme.surface2
        }
    }

    private func run(_ status: String) {
        busy = true
        Task {
            await set(status)
            busy = false
        }
    }
}
