import SwiftUI

/// The first-run setup for a new household (web: pages/Onboarding.tsx, /willkommen), list first, no stock-keeping:
/// 1 "Wer gehört dazu?" (form + name) → 2 "Was nutzt ihr?" (areas) → 3 "Wo kauft ihr meistens ein?" (skipped when
/// sign-up asked) → 4 "Wo ist eure Liste heute?" (paste, photo, fresh) → 5 the 30-second walk "da · fehlt · egal"
/// → 6 "Wer kauft sonst ein?" (invite link + QR, not for one-person households) → 7 receipt + notifications.
/// Every step can be skipped; progress is kept on the server (PATCH /api/onboarding), so the web continues it too.
struct FirstRunView: View {
    let store: ServerStore
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss

    enum Step: String, CaseIterable { case who, use, shops, list, walk, invite, finish }
    /// the server keeps the older step names (onboarding-state.ts STEPS)
    private static let serverStep: [Step: String] = [.who: "home", .use: "home", .shops: "home", .list: "where", .walk: "places", .invite: "invite", .finish: "stock"]
    private static let fromServer: [String: Step] = ["home": .who, "where": .list, "places": .walk, "spots": .walk, "invite": .invite, "stock": .finish]

    @State private var step: Step = .who
    @State private var loaded = false
    @State private var form: String?
    @State private var homeName = ""
    @State private var shopsAsked = true
    @State private var showReceipt = false
    @State private var showPaperList = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var steps: [Step] {
        Step.allCases.filter { s in
            if s == .invite && form == "single" { return false }
            if s == .shops && shopsAsked { return false }
            return true
        }
    }

    private var index: Int { steps.firstIndex(of: step) ?? 0 }

    var body: some View {
        NavigationStack {
            Group {
                if !loaded {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    ScrollView {
                        VStack(alignment: .leading, spacing: Theme.Space.s5) {
                            progress
                            content
                        }
                        .padding(Theme.Space.s5)
                        .frame(maxWidth: 600)
                        .frame(maxWidth: .infinity)
                    }
                    .scrollDismissesKeyboard(.interactively)
                }
            }
            .canvasBackground()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    if index > 0 { Button { go(steps[index - 1]) } label: { Label(L("Back"), systemImage: "chevron.left") } }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(L("Skip setup")) { Task { await close(skipped: true) } }
                }
            }
            .sheet(isPresented: $showReceipt) { ReceiptCaptureView(store: store) }
            .sheet(isPresented: $showPaperList) { PaperListSheet(store: store) }
        }
        .interactiveDismissDisabled()
        .task { await load() }
    }

    private var progress: some View {
        HStack(spacing: 4) {
            ForEach(Array(steps.enumerated()), id: \.offset) { i, _ in
                Capsule().fill(i <= index ? Theme.primary : Theme.line).frame(height: 4)
            }
        }
        .accessibilityElement()
        .accessibilityLabel(LF("Step %d of %d", index + 1, steps.count))
    }

    @ViewBuilder private var content: some View {
        switch step {
        case .who: FirstRunWho(form: $form, name: $homeName) { next() }
        case .use: FirstRunModules { next() }
        case .shops: FirstRunShops { next() }
        case .list: FirstRunList(store: store, photo: { showPaperList = true }) { next() }
        case .walk: FirstRunWalk(store: store, form: form ?? "couple") { next() }
        case .invite: FirstRunInvite(api: store.api, form: form ?? "family") { next() }
        case .finish:
            FirstRunFinish(receipt: { showReceipt = true }, done: { Task { await close(skipped: false) } })
        }
    }

    private func load() async {
        if let g = try? await store.api.gettingStarted() {
            if g.formChosen { form = g.form }
            homeName = g.household?.name ?? ""
            if let s = g.state?.step, let f = Self.fromServer[s] { step = f }
            if g.state?.started != true {
                _ = try? await store.api.send("PATCH", "api/onboarding", json: ["started": true], as: Ignored.self)
            }
        }
        // asked once: at cloud sign-up or here
        if let c: JSONValue = try? await store.api.get("api/shop/stores/choices") { shopsAsked = c["chosen"]?.bool ?? true }
        loaded = true
    }

    private func go(_ s: Step) {
        if reduceMotion { step = s } else { withAnimation(Motion.standard) { step = s } }
        if let server = Self.serverStep[s] {
            Task { _ = try? await store.api.send("PATCH", "api/onboarding", json: ["step": server], as: Ignored.self) }
        }
    }

    private func next() {
        let list = steps
        let i = list.firstIndex(of: step) ?? 0
        go(i + 1 < list.count ? list[i + 1] : .finish)
    }

    private func close(skipped: Bool) async {
        _ = try? await store.api.send("PATCH", "api/onboarding", json: ["closed": true, "skipped": skipped, "started": true], as: Ignored.self)
        store.touch("*")
        await store.refreshList()
        await app.loadAIState()
        dismiss()
    }
}

// MARK: - shared bits

private struct StepHeader: View {
    var eyebrow: String?
    let title: String
    var lead: String?

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s2) {
            if let eyebrow {
                Text(eyebrow).font(.caption.weight(.semibold)).textCase(.uppercase).foregroundStyle(Theme.ink3)
            }
            Text(title).font(Theme.title()).foregroundStyle(Theme.ink)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            if let lead {
                Text(lead).foregroundStyle(Theme.ink2).fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

/// A big selectable row (form tiles, list ways, receipt ways).
private struct ChoiceTile: View {
    let symbol: String
    let title: String
    var hint: String?
    var selected = false
    var chevron = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: Theme.Space.s3) {
                Image(systemName: symbol)
                    .font(.title3)
                    .foregroundStyle(selected ? Theme.onPrimary : Theme.primaryText)
                    .frame(width: 44, height: 44)
                    .background(selected ? Theme.primary : Theme.primarySoft, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.body.weight(.semibold)).foregroundStyle(Theme.ink)
                    if let hint { Text(hint).font(.subheadline).foregroundStyle(Theme.ink2).fixedSize(horizontal: false, vertical: true) }
                }
                .multilineTextAlignment(.leading)
                Spacer(minLength: 0)
                if selected { Image(systemName: "checkmark").font(.body.weight(.bold)).foregroundStyle(Theme.primaryText) }
                else if chevron { Image(systemName: "chevron.right").foregroundStyle(Theme.ink3) }
            }
            .padding(Theme.Space.s3)
            .frame(maxWidth: .infinity, minHeight: 64, alignment: .leading)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
            .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).stroke(selected ? Theme.primary : Theme.line, lineWidth: selected ? 2 : 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

private struct NextButton: View {
    var title = L("Next")
    var busy = false
    var disabled = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack {
                if busy { ProgressView().tint(Theme.onPrimary) }
                Text(title)
                Image(systemName: "arrow.right").accessibilityHidden(true)
            }
        }
        .buttonStyle(PrimaryButtonStyle())
        .disabled(busy || disabled)
        .padding(.top, Theme.Space.s2)
    }
}

// MARK: 1 · Wer gehört dazu?

private struct FirstRunWho: View {
    @Binding var form: String?
    @Binding var name: String
    let next: () -> Void
    @Environment(AppModel.self) private var app
    @State private var busy = false
    @State private var error: String?

    static let forms: [(key: String, symbol: String, label: String, hint: String)] = [
        ("single", "person", "Just me", "One list, nothing to share."),
        ("couple", "person.2", "The two of us", "One list for both, live on both phones."),
        ("family", "figure.2.and.child.holdinghands", "Family", "Everyone adds, whoever shops sees it."),
        ("shared", "house", "Shared flat", "Shared things together, your own stays yours."),
        ("carer", "heart", "I also look after someone", "For example parents or a neighbour – their list next to yours."),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s4) {
            StepHeader(eyebrow: L("Welcome"), title: L("Who belongs to it?"),
                       lead: L("ToHuus adapts its suggestions and wording. You can change it any time."))
            VStack(spacing: Theme.Space.s2) {
                ForEach(Self.forms, id: \.key) { f in
                    ChoiceTile(symbol: f.symbol, title: L(f.label), hint: L(f.hint), selected: form == f.key) {
                        form = f.key
                        Haptics.tick()
                    }
                }
            }
            VStack(alignment: .leading, spacing: Theme.Space.s2) {
                Text(L("What do you call your home?")).font(.subheadline.weight(.semibold))
                TextField(L("e.g. Familie Berg, Rotdornweg"), text: $name)
                    .textFieldStyle(.roundedBorder)
                    .submitLabel(.done)
            }
            if let error { ErrorBanner(message: error) }
            NextButton(busy: busy, disabled: form == nil) { Task { await save() } }
        }
    }

    private func save() async {
        guard let form, let api = app.api else { return }
        busy = true
        defer { busy = false }
        error = nil
        var body: [String: Any] = ["form": form]
        let n = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if !n.isEmpty { body["household"] = String(n.prefix(60)) }
        do {
            _ = try await api.send("PUT", "api/onboarding/home", json: body, as: Ignored.self)
            await app.loadAIState()
            next()
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }
}

// MARK: 2 · Was nutzt ihr?

private struct FirstRunModules: View {
    let next: () -> Void
    @Environment(AppModel.self) private var app
    @State private var modules: [String: Bool] = [:]
    @State private var error: String?

    static let items: [(key: String, symbol: String, label: String, hint: String)] = [
        ("stock", "cabinet", "Pantry", "What is at home and what should be eaten soon."),
        ("cook", "fork.knife", "Cook", "Recipes, ideas from what you have, a week plan if you like."),
        ("money", "eurosign.circle", "Money", "What food and household cost, from your receipts."),
        ("treats", "heart", "Treats", "Wishes from the sofa: tea, a snack, a drink."),
        ("homeinfo", "wrench.and.screwdriver", "Home info", "Care tasks and things to know about the home."),
        ("guests", "party.popper", "Guests & party", "Guest links, a party board, orders from guests."),
        ("ha", "house.circle", "Home Assistant", "Only if you run Home Assistant."),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s4) {
            StepHeader(title: L("What do you use?"),
                       lead: L("Switch off what you don’t need – the app gets smaller. You can switch it back on any time."))
            VStack(spacing: 0) {
                HStack(spacing: Theme.Space.s3) {
                    icon("cart")
                    VStack(alignment: .leading, spacing: 2) {
                        Text(L("Shopping")).font(.body.weight(.semibold))
                        Text(L("The shared list – always on.")).font(.caption).foregroundStyle(Theme.ink2)
                    }
                    Spacer()
                    Text(L("always")).font(.caption).foregroundStyle(Theme.ink3)
                }
                .padding(Theme.Space.s3)
                ForEach(Self.items, id: \.key) { i in
                    Divider().padding(.leading, 68)
                    Toggle(isOn: Binding(get: { modules[i.key] ?? true }, set: { on in Task { await set(i.key, on) } })) {
                        HStack(spacing: Theme.Space.s3) {
                            icon(i.symbol)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(L(i.label)).font(.body.weight(.semibold))
                                Text(L(i.hint)).font(.caption).foregroundStyle(Theme.ink2).fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                    .tint(Theme.primary)
                    .padding(Theme.Space.s3)
                }
            }
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
            .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).stroke(Theme.line, lineWidth: 1))
            if let error { ErrorBanner(message: error) }
            NextButton { next() }
        }
        .task { if let m: [String: Bool] = try? await app.api?.get("api/modules") { modules = m } }
    }

    private func icon(_ s: String) -> some View {
        Image(systemName: s).foregroundStyle(Theme.primaryText)
            .frame(width: 40, height: 40)
            .background(Theme.primarySoft, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
            .accessibilityHidden(true)
    }

    private func set(_ key: String, _ on: Bool) async {
        let old = modules
        modules[key] = on
        error = nil
        do {
            _ = try await app.api?.send("PUT", "api/modules", json: [key: on], as: Ignored.self)
            await app.loadAIState()
        } catch {
            modules = old
            self.error = APIError.from(error).localizedDescription
        }
    }
}

// MARK: 3 · Wo kauft ihr meistens ein?

private struct FirstRunShops: View {
    let next: () -> Void
    @Environment(AppModel.self) private var app
    @State private var choices: [String] = []
    @State private var picked: [String] = []
    @State private var own = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s4) {
            StepHeader(title: L("Where do you usually shop?"),
                       lead: L("Store mode and “Where to buy?” show these shops – the ones you use most come first."))
            FlowLayout(spacing: 8) {
                ForEach(all, id: \.self) { s in
                    ChoiceChip(title: s, on: picked.contains(s)) {
                        if let i = picked.firstIndex(of: s) { picked.remove(at: i) } else { picked.append(s) }
                    }
                }
            }
            HStack {
                TextField(L("Other shop, e.g. farm shop"), text: $own)
                    .textFieldStyle(.roundedBorder)
                    .submitLabel(.done)
                    .onSubmit(addOwn)
                Button(L("Add"), action: addOwn).disabled(own.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            Text(L("Pick as many as you like – you can change it any time.")).font(.footnote).foregroundStyle(Theme.ink3)
            if let error { ErrorBanner(message: error) }
            NextButton(busy: busy) { Task { await save() } }
        }
        .task {
            guard let api = app.api, let c: JSONValue = try? await api.get("api/shop/stores/choices") else { return }
            choices = (c["stores"]?.array?.compactMap(\.string) ?? []) + [c["market"]?.string].compactMap { $0 }
            picked = c["own"]?.array?.compactMap(\.string) ?? []
        }
    }

    private var all: [String] { choices + picked.filter { !choices.contains($0) } }

    private func addOwn() {
        let n = own.trimmingCharacters(in: .whitespaces)
        guard !n.isEmpty else { return }
        if !picked.contains(where: { $0.caseInsensitiveCompare(n) == .orderedSame }) { picked.append(n) }
        own = ""
    }

    private func save() async {
        busy = true
        defer { busy = false }
        do {
            _ = try await app.api?.send("PUT", "api/shop/stores/choice", json: ["stores": picked], as: Ignored.self)
            next()
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }
}

// MARK: 4 · Wo ist eure Liste heute?

private struct FirstRunList: View {
    let store: ServerStore
    let photo: () -> Void
    let next: () -> Void
    @State private var pasting = false
    @State private var text = ""
    @State private var busy = false
    @State private var note: String?
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s4) {
            StepHeader(title: L("Where is your list today?"), lead: L("Bring it along – nothing has to be typed twice."))
            if pasting {
                TextEditor(text: $text)
                    .frame(minHeight: 160)
                    .padding(8)
                    .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
                    .overlay(RoundedRectangle(cornerRadius: Theme.Radius.base).stroke(Theme.line, lineWidth: 1))
                    .focused($focused)
                    .accessibilityLabel(L("Paste your list"))
                Text(L("From WhatsApp, Notes or an e-mail – one thing per line or separated by commas."))
                    .font(.footnote).foregroundStyle(Theme.ink3)
                HStack {
                    Spacer()
                    Button(L("Back")) { pasting = false }.frame(minHeight: 44)
                }
                NextButton(title: L("Put it on the list"), busy: busy, disabled: text.trimmingCharacters(in: .whitespacesAndNewlines).count < 2) {
                    Task { await takeOver() }
                }
            } else {
                ChoiceTile(symbol: "text.alignleft", title: L("Paste text"), hint: L("From WhatsApp, Notes, an e-mail …"), chevron: true) {
                    pasting = true
                    focused = true
                }
                ChoiceTile(symbol: "camera", title: L("Photo of the paper list"), hint: L("Read on this iPhone – you pick the lines."), chevron: true, action: photo)
                ChoiceTile(symbol: "sparkles", title: L("Start fresh"), hint: L("The next step fills the list in 30 seconds."), chevron: true, action: next)
                if let note { Text(note).font(.footnote).foregroundStyle(Theme.primaryText) }
                if store.list.openCount > 0 {
                    NextButton { next() }
                }
            }
        }
    }

    private func takeOver() async {
        busy = true
        defer { busy = false }
        let lines = text.split(whereSeparator: \.isNewline).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        for l in lines { await store.add(text: l) }
        note = lines.count == 1 ? L("1 thing is on your list") : LF("%d things are on your list", lines.count)
        Haptics.success()
        text = ""
        pasting = false
        next()
    }
}

// MARK: 5 · 30 Sekunden: was fehlt?

private struct FirstRunWalk: View {
    let store: ServerStore
    let form: String
    let next: () -> Void
    @State private var i = 0
    @State private var answers: [String] = []
    @State private var busy = false
    @State private var error: String?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private static let base = ["Milk", "Bread", "Eggs", "Butter", "Coffee", "Pasta", "Rice", "Onions", "Tinned tomatoes", "Cheese", "Toilet paper", "Washing-up liquid"]
    private static let extra: [String: [String]] = [
        "single": ["Muesli", "Frozen pizza"],
        "family": ["Yoghurt", "Apples", "Juice", "Bananas"],
        "shared": ["Oat milk", "Bin bags", "Sponges"],
        "carer": ["Mineral water", "Rusks", "Tea"],
    ]

    private var items: [String] {
        let e = Self.extra[form] ?? ["Bananas", "Yoghurt"]
        return Array((e + Self.base).prefix(max(12, e.count + 10)))
    }
    private var done: Bool { i >= items.count }
    private var missing: [String] { items.indices.filter { answers.indices.contains($0) && answers[$0] == "missing" }.map { L(items[$0]) } }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s4) {
            StepHeader(title: L("30 seconds: what’s missing?"), lead: L("Just tap – no counting. Whatever is missing goes on the list."))
            if !done {
                VStack(spacing: Theme.Space.s4) {
                    Text(LF("%d of %d", i + 1, items.count)).font(.caption).foregroundStyle(Theme.ink3)
                    Text(L(items[i]))
                        .font(Theme.title(Theme.FontSize.h1))
                        .foregroundStyle(Theme.ink)
                        .frame(maxWidth: .infinity, minHeight: 120)
                        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
                        .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).stroke(Theme.line, lineWidth: 1))
                        .id(i)
                        .transition(reduceMotion ? .opacity : .asymmetric(insertion: .move(edge: .trailing).combined(with: .opacity), removal: .opacity))
                        .accessibilityAddTraits(.updatesFrequently)
                    HStack(spacing: Theme.Space.s2) {
                        Button { answer("here") } label: {
                            Label(L("It’s here"), systemImage: "checkmark").frame(maxWidth: .infinity, minHeight: 50)
                        }
                        .buttonStyle(.bordered)
                        Button { answer("missing") } label: {
                            Label(L("Missing"), systemImage: "plus").frame(maxWidth: .infinity, minHeight: 50)
                        }
                        .buttonStyle(.borderedProminent)
                    }
                    .font(.body.weight(.semibold))
                    HStack {
                        if i > 0 {
                            Button { back() } label: { Label(L("One back"), systemImage: "arrow.uturn.backward") }
                        }
                        Spacer()
                        Button(L("Don’t care")) { answer("skip") }
                    }
                    .font(.subheadline)
                    .frame(minHeight: 44)
                }
                Button(L("Skip")) { next() }.frame(maxWidth: .infinity, minHeight: 44)
            } else {
                VStack(alignment: .leading, spacing: Theme.Space.s2) {
                    Text(missing.isEmpty ? L("Nothing missing – nice.") : missing.count == 1 ? L("1 thing goes on the list:") : LF("%d things go on the list:", missing.count))
                        .font(.headline)
                    if !missing.isEmpty { Text(missing.joined(separator: ", ")).foregroundStyle(Theme.ink2) }
                }
                if let error { ErrorBanner(message: error) }
                NextButton(busy: busy) { Task { await finish() } }
            }
        }
    }

    private func answer(_ a: String) {
        if answers.count > i { answers[i] = a } else { answers.append(a) }
        if a == "missing" { Haptics.tick() }
        Motion.perform(Motion.quick) { i += 1 }
    }

    private func back() {
        Motion.perform(Motion.quick) { i = max(0, i - 1) }
    }

    private func finish() async {
        busy = true
        defer { busy = false }
        do {
            if !missing.isEmpty { try await store.api.quickAddNames(missing.map { NameItem(name: $0) }) }
            store.touch("shopping")
            await store.refreshList()
            next()
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }
}

// MARK: 6 · Wer kauft sonst ein?

private struct FirstRunInvite: View {
    let api: APIClient
    let form: String
    let next: () -> Void
    @State private var name = ""
    @State private var link: InviteLink?
    @State private var busy = false
    @State private var error: String?

    private var lead: String {
        switch form {
        case "couple": return L("Shared lists only work when everyone can add to them. Your partner gets a personal link and picks their own password.")
        case "shared": return L("Shared lists only work when everyone can add to them. Each flatmate gets a personal link and picks their own password.")
        default: return L("Shared lists only work when everyone can add to them. Everyone gets a personal link and picks their own password.")
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s4) {
            StepHeader(title: L("Who else does the shopping?"), lead: lead)
            Text(L("Bonus: under “Treats” you can ask each other for a little something – “vanilla ice cream, please” from the sofa – and someone brings it."))
                .font(.footnote).foregroundStyle(Theme.ink3)
                .fixedSize(horizontal: false, vertical: true)
            if let link {
                VStack(spacing: Theme.Space.s3) {
                    Text(LF("Invitation for %@", link.forName ?? "")).font(.headline)
                    if let img = PairQR.make(link.url) {
                        Image(uiImage: img).interpolation(.none).resizable().scaledToFit()
                            .frame(maxWidth: 220)
                            .padding(10)
                            .background(Color.white, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
                            .accessibilityLabel(L("QR code of the invitation"))
                    }
                    if let url = URL(string: link.url) {
                        ShareLink(item: url, subject: Text(L("Invitation")), message: Text(L("Join our household app – set your own password here:"))) {
                            Label(L("Share"), systemImage: "square.and.arrow.up").frame(maxWidth: .infinity)
                        }
                        .buttonStyle(PrimaryButtonStyle())
                    }
                    Text(L("Scan it with their phone or send the link. It works once and for 7 days."))
                        .font(.footnote).foregroundStyle(Theme.ink3).multilineTextAlignment(.center)
                    Button { self.link = nil } label: { Label(L("Invite someone else"), systemImage: "person.badge.plus") }
                        .frame(minHeight: 44)
                }
                .padding(Theme.Space.s4)
                .frame(maxWidth: .infinity)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
                .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).stroke(Theme.line, lineWidth: 1))
            } else {
                VStack(alignment: .leading, spacing: Theme.Space.s2) {
                    Text(L("Their name")).font(.subheadline.weight(.semibold))
                    TextField(L("e.g. Mira"), text: $name)
                        .textFieldStyle(.roundedBorder)
                        .textContentType(.givenName)
                        .submitLabel(.go)
                        .onSubmit { Task { await create() } }
                    Button {
                        Task { await create() }
                    } label: {
                        HStack { if busy { ProgressView() }; Label(L("Create invitation"), systemImage: "person.badge.plus") }
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.bordered)
                    .disabled(busy || name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            if let error { ErrorBanner(message: error) }
            if link != nil {
                NextButton { next() }
            } else {
                Button(L("Skip for now")) { next() }.frame(maxWidth: .infinity, minHeight: 44)
            }
        }
    }

    private func create() async {
        let n = name.trimmingCharacters(in: .whitespaces)
        guard !n.isEmpty else { return }
        busy = true
        defer { busy = false }
        error = nil
        do {
            var r = try await api.createInvite(name: n, email: nil, role: "member", kind: "member", guestLevel: nil, message: nil, send: false)
            r.forName = n
            link = r
            name = ""
            Haptics.success()
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }
}

// MARK: 7 · Bon teilen + Mitteilungen

private struct FirstRunFinish: View {
    let receipt: () -> Void
    let done: () -> Void
    @Environment(AppModel.self) private var app
    @State private var push = PushManager.shared

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s4) {
            StepHeader(title: L("Share a receipt?"),
                       lead: L("From every receipt ToHuus remembers what you buy and how often – that’s where the suggestions on “Today” come from. And “Money” shows where it goes."))
            ChoiceTile(symbol: "doc.text.viewfinder", title: L("Add a receipt"), hint: L("Photo, PDF or eBon – supermarket, drugstore, bakery …"), chevron: true, action: receipt)
            if push.state == .notAsked {
                VStack(alignment: .leading, spacing: Theme.Space.s2) {
                    Label(L("Know when someone adds something"), systemImage: "bell.badge").font(.headline)
                    Text(L("A short note when the list changes or someone is out shopping. You choose what – in More › Notifications."))
                        .font(.subheadline).foregroundStyle(Theme.ink2)
                        .fixedSize(horizontal: false, vertical: true)
                    Button(L("Turn on notifications")) { Task { await push.enable() } }
                        .buttonStyle(.bordered)
                        .frame(minHeight: 44)
                }
                .padding(Theme.Space.s4)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
                .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).stroke(Theme.line, lineWidth: 1))
            }
            NextButton(title: L("Later – to Today"), action: done)
        }
        .task { await push.refreshAuthorization(registerIfAllowed: false) }
    }
}

// MARK: - when it opens

extension View {
    /// Opens the first-run setup once per launch for an admin of a brand-new household (GET /api/onboarding
    /// wizardDue), after the sample-data question – like the web's redirect to /willkommen.
    func firstRunSetup(store: ServerStore) -> some View { modifier(FirstRunGate(store: store)) }
}

private struct FirstRunGate: ViewModifier {
    let store: ServerStore
    @Environment(AppModel.self) private var app
    @State private var show = false
    @MainActor private static var shown: Set<String> = []

    func body(content: Content) -> some View {
        content
            .task(id: "\(app.session?.householdId ?? "")|\(app.askSampleData)") { await check() }
            .fullScreenCover(isPresented: $show) { FirstRunView(store: store) }
    }

    private func check() async {
        #if DEBUG
        if UserDefaults.standard.bool(forKey: "debugFirstRun") { show = true; return }
        if UserDefaults.standard.string(forKey: "debugToken") != nil { return }
        #endif
        guard !app.askSampleData, !app.isGuest else { return }
        let key = (app.session?.serverURL.absoluteString ?? "") + "|" + (app.session?.householdId ?? "")
        guard !Self.shown.contains(key) else { return }
        // the sample-data question and the app tour go first; then give their sheet a moment to close
        var waited = 0
        while ((AppTourView.due || app.aiConsentNeeded) && waited < 180) || app.askSampleData {
            waited += 1
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            if Task.isCancelled { return }
        }
        try? await Task.sleep(nanoseconds: 700_000_000)
        guard let g = try? await store.api.gettingStarted(), g.wizardDue == true, g.admin == true, !app.askSampleData else { return }
        Self.shown.insert(key)
        show = true
    }
}
