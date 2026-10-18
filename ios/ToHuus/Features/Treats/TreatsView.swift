import SwiftUI

/// "Für mich" (web: web/src/pages/Order.tsx, mode "me"): stuck on the sofa, in bed or with bedtime – ask for a little
/// something, someone at home brings it. The others answer "I'll bring it" / "Can't right now"; the person who asked
/// can say a tiny private "thanks". No points, no count of who brought what.
struct TreatsView: View {
    let api: APIClient
    @Environment(AppModel.self) private var app
    @State private var menu: [TreatItem]?
    @State private var helpers: [TreatHelper] = []
    @State private var mine: [TreatOrder] = []
    @State private var requests: [TreatOrder] = []
    @State private var error: String?
    @State private var bringBy: Int?
    @State private var cart: [CartLine] = []
    @State private var tile: Tile?
    @State private var optionsFor: TreatItem?
    @State private var checkout = false
    @State private var declining: TreatOrder?
    @State private var toast: ToastMessage?

    struct CartLine: Identifiable, Hashable {
        var productId: Int
        var name: String
        var qty: Int
        var options: [String]
        var id: String { "\(productId)|\(options.joined(separator: ","))" }
    }

    struct Tile: Identifiable {
        var key: String
        var label: String
        var icon: String
        var items: [TreatItem]
        var id: String { key }
    }

    private var count: Int { cart.reduce(0) { $0 + $1.qty } }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.s5) {
                intro
                if let error { ErrorBanner(message: error) { Task { await load() } } }
                if !requests.isEmpty { inbox }
                let open = mine.filter { $0.kind != "party" || $0.status != "done" }.prefix(4)
                if !open.isEmpty {
                    VStack(alignment: .leading, spacing: Theme.Space.s2) {
                        SectionLabel(L("Your wishes"))
                        ForEach(Array(open)) { o in wishRow(o) }
                    }
                }
                tilesGrid
            }
            .padding(Theme.Space.s4)
            .padding(.bottom, count > 0 ? 90 : 24)
        }
        .canvasBackground()
        // an answered request changes in place ("I'll bring it" → on its way), the cart bar slides in
        .motion(value: (requests + mine).map { "\($0.id):\($0.status)" } + ["\(count)"])
        .navigationTitle(L("For me"))
        .onAppear { app.screenContext = "guests" }
        .onDisappear { if app.screenContext == "guests" { app.screenContext = nil } }
        .navigationBarTitleDisplayMode(.inline)
        .overlay(alignment: .bottom) { if count > 0 { cartBar } }
        .task {
            // like the web: refresh every 20 s while the page is open
            while !Task.isCancelled {
                await load()
                try? await Task.sleep(nanoseconds: 20_000_000_000)
            }
        }
        // live like the web: the server's "orders" change events (SSE via ServerStore) refresh at once
        .task(id: app.store?.revision("orders") ?? 0) { await load() }
        .refreshable { await load() }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                // web Order.tsx: "Edit menu" for everyone but permanent guests
                if let store = app.store, !app.isGuest {
                    NavigationLink { MenuEditorView(store: store) } label: { Label(L("Edit menu"), systemImage: "pencil") }
                }
            }
        }
        .sheet(item: $tile) { t in tileSheet(t) }
        .sheet(isPresented: $checkout) {
            TreatCheckoutSheet(cart: $cart, helpers: helpers, bringBy: $bringBy) { note in await send(note: note) }
        }
        .confirmationDialog(declining.map { LF("Tell %@ why (optional):", $0.guestName ?? "") } ?? "",
                            isPresented: Binding(get: { declining != nil }, set: { if !$0 { declining = nil } }),
                            titleVisibility: .visible, presenting: declining) { o in
            ForEach(TreatReasons.all, id: \.self) { r in
                Button(TreatReasons.label(r)) { Task { await answer(o, "declined", reason: r) } }
            }
            Button(L("Just “not now”")) { Task { await answer(o, "declined") } }
            Button(L("Cancel"), role: .cancel) {}
        }
        .toast($toast)
    }

    // MARK: intro + who brings it

    private var intro: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s3) {
            Text(L("What would you like?")).font(Theme.title(Theme.FontSize.h2)).foregroundStyle(Theme.onBlock)
            Text(L("Stuck on the sofa, in bed or with bedtime? Ask for a little something – someone at home brings it."))
                .font(.subheadline).foregroundStyle(Theme.onBlock.opacity(0.85))
                .fixedSize(horizontal: false, vertical: true)
            if !helpers.isEmpty {
                Text(L("Who brings it?")).font(.caption.weight(.semibold)).foregroundStyle(Theme.onBlock.opacity(0.85))
                    .padding(.top, Theme.Space.s1)
                FlowLayout(spacing: 8) {
                    whoChip(nil, L("Whoever can"), nil)
                    ForEach(helpers) { h in whoChip(h.id, h.name, h.color) }
                }
            }
        }
        .padding(Theme.Space.s4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.block, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
    }

    private func whoChip(_ id: Int?, _ name: String, _ color: String?) -> some View {
        let on = bringBy == id
        return Button { bringBy = id } label: {
            HStack(spacing: 6) {
                if id == nil {
                    Image(systemName: "person.2").font(.caption)
                } else {
                    PersonAvatar(name: name, key: id.map { "u\($0)" }, size: 22, api: api)
                }
                Text(name).font(.subheadline).lineLimit(1)
            }
            .padding(.leading, id == nil ? 12 : 4).padding(.trailing, 12).padding(.vertical, 6)
            .frame(minHeight: 36)
            .foregroundStyle(on ? Theme.block : Theme.onBlock)
            .background(on ? Theme.onBlock : Theme.onBlock.opacity(0.12), in: Capsule())
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? [.isSelected, .isButton] : .isButton)
    }

    // MARK: the others' wishes ("Für dich")

    private var inbox: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s2) {
            SectionLabel(L("For you"))
            ForEach(requests) { o in
                VStack(alignment: .leading, spacing: Theme.Space.s2) {
                    HStack(alignment: .top, spacing: Theme.Space.s3) {
                        PersonAvatar(name: o.guestName ?? "?", key: o.userId.map { "u\($0)" }, size: 36, api: api)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(o.forUserId != nil ? LF("%@ asks you", o.guestName ?? "") : LF("%@ would love something", o.guestName ?? ""))
                                .font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                            Text([o.itemsText, ServerDate.relative(o.createdAt)].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                                .font(.subheadline).foregroundStyle(Theme.ink2)
                                .fixedSize(horizontal: false, vertical: true)
                            if let n = o.note, !n.isEmpty, !o.lines.isEmpty {
                                Text("„\(n)“").font(.caption).foregroundStyle(Theme.ink3)
                            }
                        }
                        Spacer(minLength: 0)
                    }
                    switch o.status {
                    case "new":
                        AdaptiveButtonRow { wide in bringButton(o, wide: wide); cantButton(o, wide: wide) }
                    case "accepted":
                        let line = Text(o.byName == app.userName ? L("You’re bringing it") : o.statusLine)
                            .font(.caption.weight(.semibold)).foregroundStyle(Theme.ink2)
                        let brought = Button { Task { await answer(o, "done") } } label: { ButtonLabel(L("Brought it"), systemImage: "checkmark") }
                            .buttonStyle(.borderedProminent).tint(Theme.primary).controlSize(.regular)
                        ViewThatFits(in: .horizontal) {
                            HStack(spacing: Theme.Space.s2) { line; Spacer(minLength: Theme.Space.s2); brought }
                            VStack(alignment: .leading, spacing: Theme.Space.s2) { line.fixedSize(horizontal: false, vertical: true); brought }
                        }
                    case "done":
                        if o.thankedAt != nil {
                            Label(LF("%@ says thanks", o.guestName ?? ""), systemImage: "heart.fill")
                                .font(.caption.weight(.semibold)).foregroundStyle(Theme.low)
                        } else {
                            Text(L("Brought")).font(.caption).foregroundStyle(Theme.ink3)
                        }
                    default: EmptyView()
                    }
                }
                .padding(Theme.Space.s3)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
                .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).stroke(o.status == "new" ? Theme.mustard : Theme.line, lineWidth: o.status == "new" ? 1.5 : 1))
            }
        }
    }

    private func bringButton(_ o: TreatOrder, wide: Bool = false) -> some View {
        Button { Task { await answer(o, "accepted") } } label: { ButtonLabel(L("I’ll bring it"), systemImage: "checkmark", wide: wide) }
            .buttonStyle(.borderedProminent).tint(Theme.primary).controlSize(.regular)
    }

    private func cantButton(_ o: TreatOrder, wide: Bool = false) -> some View {
        Button { declining = o } label: { ButtonLabel(L("Can’t right now"), wide: wide) }.buttonStyle(.bordered).controlSize(.regular)
    }

    // MARK: my own wishes

    private func wishRow(_ o: TreatOrder) -> some View {
        let done = o.status == "done"
        return HStack(alignment: .center, spacing: Theme.Space.s3) {
            Circle().fill(done ? Theme.primary : o.status == "declined" ? Theme.low : Theme.mustard)
                .frame(width: 10, height: 10).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(o.itemsText).font(.subheadline).foregroundStyle(Theme.ink).fixedSize(horizontal: false, vertical: true)
                Text([o.statusLine,
                      (o.forName != nil && o.status == "new") ? LF("asked %@", o.forName ?? "") : nil,
                      ServerDate.relative(o.updatedAt ?? o.createdAt)].compactMap { $0 }.joined(separator: " · "))
                    .font(.caption).foregroundStyle(Theme.ink2).fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
            if done && (o.kind ?? "home") == "home" && o.byName != nil {
                if o.thankedAt != nil {
                    Label(L("Thanked"), systemImage: "heart.fill").font(.caption).foregroundStyle(Theme.clay).labelStyle(.iconOnly)
                        .accessibilityLabel(L("Thanked"))
                } else {
                    Button { Task { await thanks(o) } } label: { Label(L("Thanks"), systemImage: "heart") }
                        .buttonStyle(.bordered).controlSize(.small).tint(Theme.clay)
                }
            }
        }
        .padding(Theme.Space.s3)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
        .overlay(RoundedRectangle(cornerRadius: Theme.Radius.base).stroke(Theme.line, lineWidth: 1))
    }

    // MARK: tiles

    private var tiles: [Tile] {
        let items = menu ?? []
        let by: (String) -> [TreatItem] = { tag in items.filter { $0.tags?.contains(tag) == true } }
        return [
            Tile(key: "sweet", label: L("Something sweet"), icon: "birthday.cake", items: by("sweet")),
            Tile(key: "drink", label: L("Something to drink"), icon: "cup.and.saucer", items: by("drink")),
            Tile(key: "snack", label: L("Something to nibble"), icon: "popcorn", items: by("snack")),
            Tile(key: "fridge", label: L("From the fridge"), icon: "refrigerator", items: by("fridge")),
            Tile(key: "all", label: L("Everything that’s here"), icon: "shippingbox", items: items),
        ].filter { !$0.items.isEmpty }
    }

    @ViewBuilder
    private var tilesGrid: some View {
        if menu == nil && error == nil {
            ProgressView().frame(maxWidth: .infinity).padding(.top, 30)
        } else {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: Theme.Space.s3)], spacing: Theme.Space.s3) {
                ForEach(tiles) { t in
                    tileButton(t.label, t.items.count == 1 ? L("1 thing") : LF("%d things", t.items.count), t.icon, t.key) { tile = t }
                }
                tileButton(L("Something else"), L("A blanket, tea with honey …"), "text.bubble", "wish") { checkout = true }
            }
            if (menu ?? []).isEmpty {
                Text(L("Nothing is on the menu or in stock yet – “Something else” always works."))
                    .font(.caption).foregroundStyle(Theme.ink3)
            }
        }
    }

    private func tileColor(_ key: String) -> Color {
        switch key {
        case "sweet": return Theme.clay
        case "drink": return Theme.info
        case "snack": return Theme.mustard
        case "fridge": return Theme.sage
        case "wish": return Theme.primary
        default: return Theme.primaryDark
        }
    }

    private func tileButton(_ title: String, _ sub: String, _ icon: String, _ key: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: Theme.Space.s2) {
                Image(systemName: icon).font(.system(size: 24, weight: .medium))
                    .foregroundStyle(tileColor(key))
                    .frame(width: 48, height: 48)
                    .background(tileColor(key).opacity(0.16), in: Circle())
                Spacer(minLength: 0)
                Text(title).font(.headline).foregroundStyle(Theme.ink).multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                Text(sub).font(.caption).foregroundStyle(Theme.ink3).lineLimit(2)
            }
            .padding(Theme.Space.s3)
            .frame(maxWidth: .infinity, minHeight: 132, alignment: .topLeading)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
            .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).stroke(Theme.line, lineWidth: 1))
            .contentShape(RoundedRectangle(cornerRadius: Theme.Radius.lg))
        }
        .buttonStyle(.plain)
    }

    private func tileSheet(_ t: Tile) -> some View {
        NavigationStack {
            List(t.items) { i in
                Button { tap(i) } label: {
                    HStack(spacing: Theme.Space.s3) {
                        RemoteImage(url: api.imageURL(i.imagePath), api: api, placeholder: "basket")
                            .frame(width: 44, height: 44)
                            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.sm))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(i.name).foregroundStyle(Theme.ink)
                            if let sub = subtitle(i) { Text(sub).font(.caption).foregroundStyle(Theme.ink3) }
                        }
                        Spacer(minLength: 0)
                        let n = qty(i.id)
                        if n > 0 {
                            Text("\(n)×").font(.subheadline.weight(.semibold)).foregroundStyle(Theme.primaryText)
                        } else if i.isAvailable {
                            Image(systemName: "plus.circle").font(.title3).foregroundStyle(Theme.primaryText)
                                .accessibilityLabel(L("Add"))
                        }
                    }
                    .opacity(i.isAvailable ? 1 : 0.5)
                }
                .disabled(!i.isAvailable)
            }
            .navigationTitle(t.label)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Close")) { tile = nil } }
            }
            .safeAreaInset(edge: .bottom) {
                if count > 0 {
                    Button {
                        tile = nil
                        checkout = true
                    } label: {
                        Text(L("Ask for it") + " · " + (count == 1 ? L("1 thing") : LF("%d things", count)))
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .padding(Theme.Space.s4)
                    .background(.bar)
                }
            }
            .sheet(item: $optionsFor) { item in
                TreatOptionsSheet(item: item) { opts in add(item, options: opts) }
                    .presentationDetents([.medium, .large])
            }
        }
    }

    private func subtitle(_ i: TreatItem) -> String? {
        if !i.isAvailable { return i.hint ?? L("all gone") }
        if let h = i.hint, !h.isEmpty { return h }
        if let d = i.description, !d.isEmpty { return d }
        return i.options.isEmpty ? nil : L("with extras")
    }

    private var cartBar: some View {
        HStack(spacing: Theme.Space.s3) {
            Image(systemName: "basket").foregroundStyle(Theme.onPrimary)
            Text(count == 1 ? L("1 thing") : LF("%d things", count)).font(.headline).foregroundStyle(Theme.onPrimary)
            Spacer(minLength: 0)
            Button(L("Ask for it")) { checkout = true }
                .font(.headline)
                .padding(.horizontal, 16).padding(.vertical, 10)
                .background(Theme.onPrimary, in: Capsule())
                .foregroundStyle(Theme.primaryDark)
        }
        .padding(.horizontal, Theme.Space.s4).padding(.vertical, Theme.Space.s3)
        .background(Theme.primary, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
        .padding(Theme.Space.s4)
    }

    // MARK: actions

    private func qty(_ id: Int) -> Int { cart.filter { $0.productId == id }.reduce(0) { $0 + $1.qty } }

    private func tap(_ i: TreatItem) {
        guard i.isAvailable else { return }
        if i.options.isEmpty { add(i, options: []) } else { optionsFor = i }
    }

    private func add(_ i: TreatItem, options: [String]) {
        let line = CartLine(productId: i.id, name: i.name, qty: 1, options: options)
        if let idx = cart.firstIndex(where: { $0.id == line.id }) { cart[idx].qty += 1 } else { cart.append(line) }
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }

    private func load() async {
        do {
            async let m = api.treatMenu()
            async let h = api.treatHelpers()
            async let my = api.myTreats()
            async let r = api.treatRequests()
            menu = try await m
            helpers = (try? await h) ?? []
            mine = (try? await my) ?? []
            requests = (try? await r) ?? []
            error = nil
        } catch {
            if menu == nil { self.error = APIError.from(error).localizedDescription }
        }
    }

    private func send(note: String) async -> Bool {
        do {
            let n = note.trimmingCharacters(in: .whitespacesAndNewlines)
            _ = try await api.askForTreat(lines: cart.map { ($0.productId, $0.qty, $0.options) }, note: n.isEmpty ? nil : n, bringBy: bringBy)
            let who = helpers.first { $0.id == bringBy }?.name
            cart = []
            toast = ToastMessage(text: who.map { LF("Sent to %@.", $0) } ?? L("Sent – someone will answer in a moment."))
            await load()
            return true
        } catch {
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
            return false
        }
    }

    private func answer(_ o: TreatOrder, _ status: String, reason: String? = nil) async {
        declining = nil
        do {
            try await api.answerTreat(o.id, status: status, reason: reason)
            // "I'll bring it" / "Brought it" is a promise kept – a success tap; declining stays quiet
            if status == "accepted" || status == "done" { Haptics.success() } else { Haptics.tick() }
            await load()
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }

    private func thanks(_ o: TreatOrder) async {
        do {
            try await api.thankForTreat(o.id)
            toast = ToastMessage(text: o.byName.map { LF("%@ gets your thanks.", $0) } ?? L("Thanks sent."))
            await load()
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }
}

/// A small uppercase label above a group (web: .eyebrow.label-sq)
struct SectionLabel: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        Text(text.uppercased()).font(.caption.weight(.semibold)).tracking(0.6).foregroundStyle(Theme.ink3)
            .accessibilityAddTraits(.isHeader)
    }
}

/// Choices for one item ("Milch: Hafer · Kuh") before it goes into the wish.
struct TreatOptionsSheet: View {
    let item: TreatItem
    let onAdd: ([String]) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var sel: [String: [String]] = [:]

    var body: some View {
        NavigationStack {
            Form {
                if let d = item.description, !d.isEmpty { Section { Text(d).foregroundStyle(Theme.ink2) } }
                ForEach(item.options, id: \.group) { o in
                    Section {
                        FlowLayout(spacing: 8) {
                            ForEach(o.choices, id: \.self) { c in
                                ChoiceChip(title: c, on: sel[o.group]?.contains(c) == true) { toggle(o, c) }
                            }
                        }
                        .padding(.vertical, 4)
                    } header: {
                        Text(o.required == false ? "\(o.group) · \(L("optional"))" : o.group)
                    }
                }
            }
            .themedList()
            .navigationTitle(item.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(L("Add")) {
                        let picked = item.options.flatMap { sel[$0.group] ?? [] }.filter { !["Normal", "Keins", "Regular", "None"].contains($0) }
                        onAdd(picked)
                        dismiss()
                    }
                    .disabled(item.options.contains { $0.required == true && (sel[$0.group] ?? []).isEmpty })
                }
            }
            .onAppear {
                for o in item.options {
                    sel[o.group] = o.default ?? ((o.multi ?? false) ? [] : [o.choices.first].compactMap { $0 })
                }
            }
        }
    }

    private func toggle(_ o: MenuOption, _ c: String) {
        let on = sel[o.group]?.contains(c) == true
        if o.multi == true {
            sel[o.group] = on ? (sel[o.group] ?? []).filter { $0 != c } : (sel[o.group] ?? []) + [c]
        } else {
            sel[o.group] = on && o.required == false ? [] : [c]
        }
    }
}

/// "Dein Wunsch": the basket, how you'd like it, who brings it, send.
struct TreatCheckoutSheet: View {
    @Binding var cart: [TreatsView.CartLine]
    let helpers: [TreatHelper]
    @Binding var bringBy: Int?
    let onSend: (String) async -> Bool
    @Environment(\.dismiss) private var dismiss
    @State private var note = ""
    @State private var busy = false

    var body: some View {
        NavigationStack {
            Form {
                if !cart.isEmpty {
                    Section {
                        ForEach(cart) { line in
                            HStack(spacing: Theme.Space.s3) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(line.name)
                                    if !line.options.isEmpty { Text(line.options.joined(separator: ", ")).font(.caption).foregroundStyle(Theme.ink3) }
                                }
                                Spacer(minLength: 0)
                                Button { change(line, -1) } label: { Image(systemName: "minus.circle").font(.title3) }
                                    .accessibilityLabel(L("Less"))
                                Text("\(line.qty)").font(.body.monospacedDigit()).frame(minWidth: 20)
                                Button { change(line, 1) } label: { Image(systemName: "plus.circle").font(.title3) }
                                    .accessibilityLabel(L("More"))
                                    .disabled(line.qty >= 20)
                            }
                            .buttonStyle(.borderless)
                        }
                    }
                }
                Section {
                    TextField(cart.isEmpty ? L("e.g. tea with honey, a blanket, the charger from the hallway") : L("e.g. with a spoon, in the big cup, to the bedroom"),
                              text: $note, axis: .vertical)
                        .lineLimit(2...5)
                } header: { Text(cart.isEmpty ? L("What would you like?") : L("How would you like it?")) }
                if !helpers.isEmpty {
                    Section {
                        FlowLayout(spacing: 8) {
                            ChoiceChip(title: L("Whoever can"), on: bringBy == nil) { bringBy = nil }
                            ForEach(helpers) { h in ChoiceChip(title: h.name, on: bringBy == h.id) { bringBy = h.id } }
                        }
                        .padding(.vertical, 4)
                    } header: { Text(L("Who brings it?")) } footer: {
                        Text(bringBy.flatMap { id in helpers.first { $0.id == id }?.name }.map { LF("Only %@ gets the push.", $0) }
                             ?? L("Everyone at home gets the push – whoever has a free hand says “I’ll bring it”."))
                    }
                }
                Section {
                    Button {
                        busy = true
                        Task {
                            if await onSend(String(note.prefix(300))) { dismiss() }
                            busy = false
                        }
                    } label: {
                        HStack { Spacer(); Label(L("Send it"), systemImage: "checkmark"); if busy { ProgressView().padding(.leading, 6) }; Spacer() }
                    }
                    .disabled(busy || (cart.isEmpty && note.trimmingCharacters(in: .whitespaces).isEmpty))
                }
            }
            .themedList()
            .navigationTitle(L("Your wish"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } } }
        }
        .presentationDetents([.large])
    }

    private func change(_ line: TreatsView.CartLine, _ by: Int) {
        guard let i = cart.firstIndex(where: { $0.id == line.id }) else { return }
        cart[i].qty += by
        if cart[i].qty <= 0 { cart.remove(at: i) }
    }
}
