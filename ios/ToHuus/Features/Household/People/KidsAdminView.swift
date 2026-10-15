import SwiftUI

/// "Kinder" – the parents' side of kid mode: kid profiles with an animal, colour, reading level, read aloud and a parent
/// PIN; paired kid tablets; rules; the kids' "Where is …?"; and the wishes waiting for a grown-up. An iPad or iPhone
/// can itself become a kid tablet (KidModeView). Web: pages/KidsSettings.tsx. No points, no stars, no ranking.
struct KidsAdminView: View {
    let api: APIClient
    let isAdmin: Bool
    @State private var kids: [KidProfile] = []
    @State private var wishes: [KidWish] = []
    @State private var loaded = false
    @State private var error: String?
    @State private var edit: KidEdit?
    @State private var showLink = false
    @State private var toast: ToastMessage?

    var body: some View {
        List {
            Section {
                Text(L("A kid tablet shows big pictures of what your kid may wish for. Every wish waits for a parent – approved wishes land on the order board. No points, no stars."))
                    .font(.subheadline).foregroundStyle(Theme.ink2)
            }
            if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
            KidWishesSection(api: api, wishes: wishes, alwaysShow: true) { msg in
                toast = ToastMessage(text: msg)
                Task { await load() }
            } failed: { toast = ToastMessage(text: $0, isError: true) }
            Section(L("Kids")) {
                if loaded && kids.isEmpty {
                    VStack(spacing: Theme.Space.s3) {
                        KidAnimalView(animal: "fox", size: 56)
                        Text(L("No kid profiles yet")).font(.headline)
                        Text(isAdmin ? L("Add a kid, pick an animal and pair a tablet.") : L("An admin can add kid profiles."))
                            .font(.subheadline).foregroundStyle(Theme.ink2).multilineTextAlignment(.center)
                        if isAdmin {
                            Button(L("Add kid")) { edit = KidEdit(kid: nil) }.buttonStyle(PrimaryButtonStyle()).frame(maxWidth: 260)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, Theme.Space.s4)
                }
                ForEach(kids) { k in
                    NavigationLink {
                        KidDetailView(api: api, kidId: k.id, isAdmin: isAdmin) { Task { await load() } }
                    } label: { kidRow(k) }
                }
            }
            if isAdmin {
                Section {
                    Button { showLink = true } label: { Label(L("Open a kid tablet link on this device"), systemImage: "link") }
                } footer: {
                    Text(L("Paired on another phone? Paste the link here and this device becomes the kid tablet."))
                }
            }
        }
        .themedList()
        .navigationTitle(L("Kids"))
        .toolbar {
            if isAdmin {
                ToolbarItem(placement: .primaryAction) {
                    Button { edit = KidEdit(kid: nil) } label: { Label(L("Add kid"), systemImage: "plus") }
                }
            }
        }
        .task { await load() }
        .refreshable { await load() }
        .sheet(item: $edit) { e in KidFormSheet(api: api, kid: e.kid) { Task { await load() } } }
        .sheet(isPresented: $showLink) { KidLinkSheet() }
        .toast($toast)
    }

    private func kidRow(_ k: KidProfile) -> some View {
        HStack(spacing: Theme.Space.s3) {
            KidAnimalView(animal: k.avatar, color: k.color, size: 52)
            VStack(alignment: .leading, spacing: 3) {
                Text(k.name).font(.body.weight(.semibold)).foregroundStyle(Theme.ink)
                Text(KidText.summary(k)).font(.caption).foregroundStyle(Theme.ink3)
                Text(KidText.rulesSummary(k.rules)).font(.caption).foregroundStyle(Theme.ink3)
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }

    private func load() async {
        do {
            async let k = api.kids()
            async let w = api.kidWishes()
            kids = try await k
            wishes = (try? await w) ?? []
            error = nil
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
        loaded = true
    }
}

struct KidEdit: Identifiable {
    let id = UUID()
    let kid: KidProfile?
}

enum KidText {
    static let colors = ["#f2a33a", "#e8742c", "#e2483d", "#d0608f", "#8e5bb8", "#4f8fd8", "#2fa58a", "#5cb85c"]

    static func summary(_ k: KidProfile) -> String {
        [k.reads ? L("reads") : L("can’t read yet"),
         k.speak == true ? L("reads aloud") : nil,
         k.hasPin == true ? L("PIN set") : L("no PIN"),
         k.devices.count == 1 ? L("1 tablet") : LF("%d tablets", k.devices.count)]
            .compactMap { $0 }.joined(separator: " · ")
    }

    static func rulesSummary(_ r: KidRules) -> String {
        let n = r.categories.count + r.products.count
        return [n == 1 ? L("1 item or group visible") : LF("%d items or groups visible", n),
                r.quiet.map { LF("quiet %@–%@", $0.from, $0.to) },
                r.limits.isEmpty ? nil : (r.limits.count == 1 ? L("1 limit") : LF("%d limits", r.limits.count))]
            .compactMap { $0 }.joined(separator: " · ")
    }
}

/// Wishes waiting for a grown-up: approve (→ order board) or "not now" (the kid sees "maybe later").
/// Members may answer too, like on the web. Can also sit on Today (alwaysShow: false hides it when empty).
struct KidWishesSection: View {
    let api: APIClient
    let wishes: [KidWish]
    var alwaysShow = false
    let answered: (String) -> Void
    let failed: (String) -> Void
    @State private var busy: Int?

    var body: some View {
        if alwaysShow || !wishes.isEmpty {
            Section(L("Kids’ wishes")) {
                if wishes.isEmpty {
                    Text(L("No wishes waiting.")).font(.subheadline).foregroundStyle(Theme.ink3)
                }
                ForEach(wishes) { w in
                    VStack(alignment: .leading, spacing: Theme.Space.s2) {
                        HStack(spacing: Theme.Space.s3) {
                            KidAnimalView(animal: w.kidAvatar, color: w.kidColor, size: 44)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(LF("%@ would like: %@", w.kidName ?? "?", w.name)).foregroundStyle(Theme.ink)
                                if let r = ServerDate.relative(w.createdAt) { Text(r).font(.caption).foregroundStyle(Theme.ink3) }
                            }
                            Spacer(minLength: 0)
                            if busy == w.id { ProgressView() }
                        }
                        .accessibilityElement(children: .combine)
                        HStack(spacing: Theme.Space.s2) {
                            Button(L("Not now")) { Task { await answer(w, approve: false) } }
                                .buttonStyle(.bordered)
                            Button(L("Approve")) { Task { await answer(w, approve: true) } }
                                .buttonStyle(.borderedProminent).tint(Theme.primary)
                        }
                        .font(.subheadline.weight(.semibold))
                        .disabled(busy != nil)
                    }
                    .padding(.vertical, 4)
                    .swipeActions(edge: .trailing) {
                        Button(L("Approve")) { Task { await answer(w, approve: true) } }.tint(Theme.primary)
                    }
                    .swipeActions(edge: .leading) {
                        Button(L("Not now")) { Task { await answer(w, approve: false) } }.tint(Theme.ink3)
                    }
                }
            }
        }
    }

    private func answer(_ w: KidWish, approve: Bool) async {
        busy = w.id
        defer { busy = nil }
        do {
            try await api.answerKidWish(w.id, approve: approve)
            Haptics.success()
            answered(approve ? L("Approved – it’s on the order board") : LF("%@ sees “maybe later”", w.kidName ?? ""))
        } catch {
            failed(APIError.from(error).localizedDescription)
        }
    }
}

/// One kid: profile, tablets (pair another one, or use this device), rules, "Where is …?", AI, delete.
struct KidDetailView: View {
    let api: APIClient
    let kidId: Int
    let isAdmin: Bool
    let onChange: () -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(AppModel.self) private var app
    @State private var kid: KidProfile?
    @State private var edit: KidEdit?
    @State private var pair = false
    @State private var useHere = false
    @State private var confirmDelete = false
    @State private var removeDevice: KidDevice?
    @State private var toast: ToastMessage?
    @State private var error: String?

    var body: some View {
        List {
            if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
            if let k = kid {
                Section {
                    HStack(spacing: Theme.Space.s4) {
                        KidAnimalView(animal: k.avatar, color: k.color, size: 64)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(k.name).font(.title3.weight(.semibold))
                            Text(KidText.summary(k)).font(.caption).foregroundStyle(Theme.ink3)
                        }
                    }
                    .accessibilityElement(children: .combine)
                    if isAdmin {
                        Button { edit = KidEdit(kid: k) } label: { Label(L("Edit profile"), systemImage: "pencil") }
                    }
                }
                if isAdmin {
                    Section {
                        NavigationLink { KidRulesView(api: api, kid: k) { reloadAll() } } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Label(L("Rules"), systemImage: "checkmark.shield")
                                Text(KidText.rulesSummary(k.rules)).font(.caption).foregroundStyle(Theme.ink3)
                            }
                        }
                        NavigationLink { KidFindView(api: api, kid: k) { reloadAll() } } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Label(L("Where is …?"), systemImage: "magnifyingglass")
                                Text(k.findIds.isEmpty ? L("off") : LF("Things (%d/12)", k.findIds.count)).font(.caption).foregroundStyle(Theme.ink3)
                            }
                        }
                    }
                }
                Section {
                    ForEach(k.devices) { d in
                        HStack(spacing: Theme.Space.s3) {
                            Image(systemName: "ipad.landscape").foregroundStyle(Theme.ink2).accessibilityHidden(true)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(d.label ?? L("Kid tablet"))
                                Text(deviceLine(d)).font(.caption).foregroundStyle(Theme.ink3)
                            }
                            Spacer()
                            if isAdmin {
                                Button(L("Remove")) { removeDevice = d }.font(.subheadline).buttonStyle(.borderless)
                            }
                        }
                        .accessibilityElement(children: .combine)
                    }
                    if isAdmin {
                        Button { pair = true } label: { Label(L("Pair a kid tablet"), systemImage: "qrcode") }
                        Button { useHere = true } label: { Label(UIDevice.current.userInterfaceIdiom == .pad ? L("Use this iPad as kid tablet") : L("Use this iPhone as kid tablet"), systemImage: "lock.rectangle.on.rectangle") }
                    }
                } header: { Text(L("Kid tablets")) } footer: {
                    Text(k.hasPin == true
                         ? L("Leaving kid mode on the tablet needs the parent PIN. You can also remove a tablet here.")
                         : L("Tip: set a parent PIN on the profile first, so you can leave kid mode on the tablet itself."))
                }
                if app.aiAvailable || k.ai != nil {
                    Section {
                        Toggle(L("AI for this child"), isOn: Binding(get: { k.ai ?? false }, set: { v in Task { await setAI(v) } }))
                    } footer: { Text(L("Off: the assistant and AI suggestions stay locked for this child.")) }
                }
                if isAdmin {
                    Section {
                        Button(role: .destructive) { confirmDelete = true } label: { Label(L("Delete profile"), systemImage: "trash") }
                    }
                }
            } else if error == nil {
                Section { ProgressView().frame(maxWidth: .infinity) }.listRowBackground(Color.clear)
            }
        }
        .themedList()
        .navigationTitle(kid?.name ?? L("Kid"))
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
        .sheet(item: $edit) { e in KidFormSheet(api: api, kid: e.kid) { reloadAll() } }
        .sheet(isPresented: $pair, onDismiss: { reloadAll() }) { if let k = kid { KidPairSheet(api: api, kid: k) } }
        .confirmationDialog(L("Use this device as kid tablet?"), isPresented: $useHere, titleVisibility: .visible) {
            Button(L("Start kid mode")) { Task { await startHere() } }
            Button(L("Cancel"), role: .cancel) {}
        } message: {
            Text(kid?.hasPin == true
                 ? L("The app then only shows kid mode until someone enters the parent PIN. Tip: turn on Guided Access (Settings › Accessibility) so the device stays in ToHuus.")
                 : L("There is no parent PIN yet – leaving kid mode then needs another phone to remove this tablet. Set a PIN on the profile first."))
        }
        .confirmationDialog(LF("Delete %@’s profile? Paired tablets stop working.", kid?.name ?? ""), isPresented: $confirmDelete, titleVisibility: .visible) {
            Button(L("Delete"), role: .destructive) { Task { await delete() } }
            Button(L("Cancel"), role: .cancel) {}
        }
        .confirmationDialog(L("Remove this tablet? It leaves kid mode right away."), isPresented: Binding(get: { removeDevice != nil }, set: { if !$0 { removeDevice = nil } }), titleVisibility: .visible, presenting: removeDevice) { d in
            Button(L("Remove"), role: .destructive) { Task { await remove(d) } }
            Button(L("Cancel"), role: .cancel) {}
        }
        .toast($toast)
    }

    private func deviceLine(_ d: KidDevice) -> String {
        var s = ServerDate.relative(d.lastSeenAt).map { LF("last seen %@", $0) } ?? L("not opened yet")
        if let e = ServerDate.parse(d.expiresAt) { s += " · " + LF("until %@", e.formatted(date: .abbreviated, time: .omitted)) }
        return s
    }

    private func reloadAll() {
        onChange()
        Task { await load() }
    }

    private func load() async {
        do {
            kid = try await api.kids().first { $0.id == kidId }
            error = kid == nil ? L("This profile is gone.") : nil
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }

    private func setAI(_ on: Bool) async {
        do {
            try await api.setKidAI(kidId, enabled: on)
            reloadAll()
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }

    private func remove(_ d: KidDevice) async {
        do {
            try await api.removeKidDevice(d.id)
            toast = ToastMessage(text: L("Tablet removed"))
            reloadAll()
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }

    private func delete() async {
        do {
            try await api.deleteKid(kidId)
            onChange()
            dismiss()
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }

    /// pairs this device like a tablet and switches the whole app into kid mode
    private func startHere() async {
        do {
            let label = UIDevice.current.userInterfaceIdiom == .pad ? L("This iPad") : L("This iPhone")
            let r = try await api.pairKidDevice(kidId, label: label, days: nil)
            KidModeStore.shared.enter(base: api.baseURL, token: r.token)
        } catch {
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
        }
    }
}

/// New kid or edit: name, animal, colour, reading, read aloud, parent PIN (web: KidsSettings.tsx KidForm).
struct KidFormSheet: View {
    let api: APIClient
    let kid: KidProfile?
    let saved: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var avatar = AnimalArt.keys.randomElement() ?? "fox"
    @State private var color = KidText.colors.randomElement() ?? "#f2a33a"
    @State private var ageBand = "pre"
    @State private var speak = true
    @State private var pin = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section(L("Name")) { TextField(L("e.g. Mika"), text: $name) }
                Section(L("Animal")) {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 64), spacing: Theme.Space.s3)], spacing: Theme.Space.s3) {
                        ForEach(AnimalArt.keys, id: \.self) { a in
                            Button { avatar = a } label: {
                                KidAnimalView(animal: a, color: color, size: 60)
                                    .overlay(Circle().stroke(avatar == a ? Theme.primary : Color.clear, lineWidth: 3).padding(-3))
                                    .padding(4)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(PeopleText.animalName(a))
                            .accessibilityAddTraits(avatar == a ? .isSelected : [])
                        }
                    }
                    .padding(.vertical, 4)
                }
                Section(L("Colour")) {
                    HStack(spacing: Theme.Space.s1) {
                        ForEach(KidText.colors, id: \.self) { c in
                            Button { color = c } label: {
                                Circle().fill(Color(hexString: c) ?? .gray).frame(width: 30, height: 30)
                                    .overlay(Circle().stroke(Theme.ink, lineWidth: color == c ? 2.5 : 0).padding(-3))
                                    .frame(width: 38, height: 44)
                                    .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(PeopleText.colorName(c))
                            .accessibilityAddTraits(color == c ? .isSelected : [])
                        }
                    }
                }
                Section {
                    Picker(L("Reading"), selection: $ageBand) {
                        Text(L("Can’t read yet")).tag("pre")
                        Text(L("Reads")).tag("reads")
                    }
                    .pickerStyle(.segmented)
                } header: { Text(L("Reading")) } footer: {
                    Text(ageBand == "pre" ? L("Pictures first, very little text.") : L("Pictures with names, and the exact spot under “Where is …?”."))
                }
                Section {
                    Toggle(isOn: $speak) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(L("Read aloud"))
                            Text(L("The tablet says the name of what was tapped – in the household language.")).font(.caption).foregroundStyle(Theme.ink3)
                        }
                    }
                }
                Section {
                    SecureField(kid?.hasPin == true ? L("PIN set – type to change") : L("4 to 8 digits"), text: $pin)
                        .keyboardType(.numberPad)
                        .textContentType(.oneTimeCode)
                        .onChange(of: pin) { _, v in
                            let d = String(v.filter(\.isNumber).prefix(8))
                            if d != v { pin = d }
                        }
                    if let k = kid, k.hasPin == true {
                        Button(L("Remove PIN"), role: .destructive) { Task { await removePin(k) } }
                    }
                } header: { Text(L("Parent PIN")) } footer: {
                    Text(L("Needed to leave kid mode on the tablet. Without a PIN, remove the tablet here instead."))
                }
                if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
            }
            .themedList()
            .navigationTitle(kid?.name ?? L("Add kid"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(L("Save")) { Task { await save() } }
                        .disabled(busy || name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .onAppear {
                guard let k = kid else { return }
                name = k.name
                avatar = k.avatar ?? "fox"
                color = k.color ?? color
                ageBand = k.ageBand ?? "pre"
                speak = k.speak ?? true
            }
        }
    }

    private func save() async {
        error = nil
        if !pin.isEmpty && !(4...8).contains(pin.count) { error = L("The PIN needs 4 to 8 digits."); return }
        busy = true
        defer { busy = false }
        var body: [String: Any] = ["name": name.trimmingCharacters(in: .whitespaces), "avatar": avatar, "color": color, "age_band": ageBand, "speak": speak]
        if !pin.isEmpty { body["pin"] = pin }
        do {
            try await api.saveKid(kid?.id, body)
            Haptics.success()
            saved()
            dismiss()
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }

    private func removePin(_ k: KidProfile) async {
        do {
            try await api.saveKid(k.id, ["pin": NSNull()])
            saved()
            dismiss()
        } catch { error = APIError.from(error).localizedDescription }
    }
}

/// Pair another tablet or old phone: a link / QR code that opens kid mode there (web: KidsSettings.tsx PairSheet).
struct KidPairSheet: View {
    let api: APIClient
    let kid: KidProfile
    @Environment(\.dismiss) private var dismiss
    @State private var label = ""
    @State private var days = 0
    @State private var link: String?
    @State private var busy = false
    @State private var error: String?
    @State private var copied = false

    var body: some View {
        NavigationStack {
            Form {
                if let link {
                    Section {
                        VStack(spacing: Theme.Space.s3) {
                            if let qr = QRCode.image(link) {
                                Image(uiImage: qr).interpolation(.none).resizable().scaledToFit()
                                    .frame(width: 220, height: 220)
                                    .padding(Theme.Space.s3)
                                    .background(Color.white, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
                                    .accessibilityLabel(L("QR code of the kid tablet link"))
                            }
                            Text(link).font(.caption.monospaced()).foregroundStyle(Theme.ink3).multilineTextAlignment(.center).textSelection(.enabled)
                            ShareLink(item: link) { Label(L("Share"), systemImage: "square.and.arrow.up") }.buttonStyle(PrimaryButtonStyle())
                            Button {
                                UIPasteboard.general.string = link
                                copied = true
                            } label: { Label(copied ? L("Link copied") : L("Copy"), systemImage: copied ? "checkmark" : "doc.on.doc") }
                                .buttonStyle(SecondaryButtonStyle())
                            Text(L("Scan the code with the kid’s tablet or open the link there. The link is shown only once."))
                                .font(.caption).foregroundStyle(Theme.ink3).multilineTextAlignment(.center)
                        }
                        .frame(maxWidth: .infinity)
                        .listRowBackground(Color.clear)
                    }
                } else {
                    Section {
                        Text(LF("Opens a link that turns a tablet or old phone into %@’s kid mode. It stays there – leaving needs the parent PIN, or you remove the tablet here.", kid.name))
                            .font(.subheadline).foregroundStyle(Theme.ink2)
                        if kid.hasPin != true {
                            Label(L("Tip: set a parent PIN on the profile first, so you can leave kid mode on the tablet itself."), systemImage: "lightbulb")
                                .font(.footnote).foregroundStyle(Theme.warning)
                        }
                    }
                    Section(L("Name of the tablet (optional)")) {
                        TextField(L("e.g. old iPad"), text: $label)
                    }
                    Section(L("Valid for")) {
                        Picker(L("Valid for"), selection: $days) {
                            Text(L("1 day")).tag(1)
                            Text(L("30 days")).tag(30)
                            Text(L("until removed")).tag(0)
                        }
                        .pickerStyle(.segmented)
                        .labelsHidden()
                    }
                    if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
                }
            }
            .themedList()
            .navigationTitle(LF("Kid tablet for %@", kid.name))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(link == nil ? L("Cancel") : L("Done")) { dismiss() } }
                if link == nil {
                    ToolbarItem(placement: .confirmationAction) {
                        Button(L("Create link")) { Task { await create() } }.disabled(busy)
                    }
                }
            }
        }
    }

    private func create() async {
        busy = true
        defer { busy = false }
        do {
            let l = label.trimmingCharacters(in: .whitespaces)
            link = try await api.pairKidDevice(kid.id, label: l.isEmpty ? nil : l, days: days == 0 ? nil : days).url
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }
}

/// Paste a kid tablet link (…/kids/<token>) – this device switches into kid mode.
struct KidLinkSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("https://…/kids/…", text: $text, axis: .vertical)
                        .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    if UIPasteboard.general.hasURLs || UIPasteboard.general.hasStrings {
                        Button { text = UIPasteboard.general.string ?? UIPasteboard.general.url?.absoluteString ?? "" } label: {
                            Label(L("Paste"), systemImage: "doc.on.clipboard")
                        }
                    }
                } footer: {
                    Text(L("The app then only shows kid mode until someone enters the parent PIN."))
                }
                if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
            }
            .themedList()
            .navigationTitle(L("Kid tablet link"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(L("Start kid mode")) {
                        if let r = KidModeStore.parse(text) {
                            dismiss()
                            KidModeStore.shared.enter(base: r.base, token: r.token)
                        } else {
                            error = L("That doesn’t look like a kid tablet link.")
                        }
                    }
                    .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
    }
}
