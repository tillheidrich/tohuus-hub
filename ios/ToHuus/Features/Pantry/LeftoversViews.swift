import SwiftUI

/// Leftovers and portions in boxes (web pages/Leftovers.tsx): put them away with a label, see what's in the fridge and
/// freezer, and tick off a box. POST /api/labels/boxes books the stock; each container gets a code for its QR label.
struct LeftoversSheet: View {
    let store: ServerStore
    @Environment(\.dismiss) private var dismiss
    @State private var boxes: [LeftoverBox] = []
    @State private var places: [Place] = []
    @State private var name = ""
    @State private var portions = 2
    @State private var containers = 1
    @State private var place = "fridge"
    @State private var hasEatBy = false
    @State private var eatBy = Calendar.current.date(byAdding: .day, value: 3, to: Date()) ?? Date()
    @State private var created: [LeftoverBox] = []
    @State private var busy = false
    @State private var error: String?
    @State private var openBox: LeftoverBox?
    @State private var shareImage: ShareImage?

    private var hasFreezer: Bool { places.contains { $0.kind == "freezer" } }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField(L("What is it? e.g. chilli, soup"), text: $name)
                    Stepper(value: $portions, in: 1...20) {
                        HStack { Text(L("Portions")); Spacer(); Text("\(portions)").monospacedDigit().foregroundStyle(Theme.ink2) }
                    }
                    Stepper(value: $containers, in: 1...min(12, portions)) {
                        HStack { Text(L("Containers")); Spacer(); Text("\(containers)").monospacedDigit().foregroundStyle(Theme.ink2) }
                    }
                    if hasFreezer {
                        Picker(L("Where to?"), selection: $place) {
                            Label(L("Fridge"), systemImage: "refrigerator").tag("fridge")
                            Label(L("Freezer"), systemImage: "snowflake").tag("freezer")
                        }
                        .pickerStyle(.segmented)
                    }
                    Toggle(L("Set my own eat-by date"), isOn: $hasEatBy.animation())
                    if hasEatBy { DatePicker(L("Eat by"), selection: $eatBy, in: Date()..., displayedComponents: .date) }
                    Button {
                        Task { await save() }
                    } label: {
                        Label(L("Put away"), systemImage: "takeoutbag.and.cup.and.straw")
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(busy || name.trimmingCharacters(in: .whitespaces).isEmpty)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                } header: {
                    Text(L("Put leftovers away"))
                } footer: {
                    Text(hasEatBy ? L("You set the date yourself.") : L("ToHuus suggests an eat-by date from what it is."))
                }
                if !created.isEmpty {
                    Section {
                        ForEach(created) { b in
                            HStack(spacing: Theme.Space.s3) {
                                RemoteImage(url: labelURL(b), api: store.api, placeholder: "qrcode")
                                    .frame(width: 72, height: 72)
                                    .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.sm))
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(b.name).font(.subheadline.weight(.semibold))
                                    Text(b.prettyCode).font(.caption.monospaced()).foregroundStyle(Theme.ink2)
                                    if let d = ServerDate.shortDay(b.eatBy) { Text(LF("eat by %@", d)).font(.caption).foregroundStyle(Theme.ink3) }
                                }
                                Spacer(minLength: 0)
                                Button { Task { await share(b) } } label: { Image(systemName: "square.and.arrow.up") }
                                    .buttonStyle(.borderless)
                                    .accessibilityLabel(L("Share the label"))
                            }
                        }
                    } header: {
                        Text(L("Put away – the labels"))
                    } footer: {
                        Text(L("Print the label or write the code on the lid. Scanning it later shows what's inside."))
                    }
                }
                Section {
                    if boxes.isEmpty {
                        Text(L("No boxes in the fridge or freezer.")).font(.subheadline).foregroundStyle(Theme.ink3)
                    }
                    ForEach(boxes) { b in
                        Button { openBox = b } label: { BoxRow(box: b, api: store.api) }
                            .buttonStyle(.plain)
                    }
                } header: {
                    Text(L("In boxes"))
                }
                if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
            }
            .navigationTitle(L("Leftovers"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Done")) { dismiss() } } }
            .task { await load() }
            .sheet(item: $openBox) { b in
                NavigationStack { BoxDetail(code: b.code, store: store) { Task { await load() } } }
                    .presentationDetents([.medium, .large])
            }
            .sheet(item: $shareImage) { s in ShopActivitySheet(items: [s.image]).presentationDetents([.medium, .large]) }
        }
    }

    private func labelURL(_ b: LeftoverBox) -> URL? { try? store.api.url("api/labels/boxes/\(b.code)/label.png") }

    private func load() async {
        let api = store.api
        async let b = try? api.boxes()
        async let p = try? api.places()
        boxes = await b ?? boxes
        places = await p ?? places
    }

    private func save() async {
        busy = true
        defer { busy = false }
        do {
            created = try await store.api.putAwayLeftovers(name: name.trimmingCharacters(in: .whitespaces), portions: Double(portions),
                                                           boxes: containers, place: hasFreezer ? place : "fridge",
                                                           eatBy: hasEatBy ? ServerDate.day(eatBy) : nil)
            Haptics.success()
            name = ""
            error = nil
            store.touch("stock", "products")
            await load()
        } catch { self.error = APIError.from(error).localizedDescription }
    }

    private func share(_ b: LeftoverBox) async {
        guard let data = try? await store.api.getData("api/labels/boxes/\(b.code)/label.png"), let img = UIImage(data: data) else {
            error = L("The label couldn't be loaded.")
            return
        }
        shareImage = ShareImage(image: img)
    }
}

struct ShareImage: Identifiable {
    let image: UIImage
    let id = UUID()
}

struct BoxRow: View {
    let box: LeftoverBox
    let api: APIClient

    var body: some View {
        HStack(spacing: Theme.Space.s3) {
            RemoteImage(url: api.imageURL(box.imagePath), api: api, placeholder: box.inFreezer ? "snowflake" : "takeoutbag.and.cup.and.straw")
                .frame(width: 44, height: 44)
                .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.sm))
            VStack(alignment: .leading, spacing: 2) {
                Text(box.name).font(Theme.rowFont).foregroundStyle(Theme.ink)
                Text([box.portionsLabel, box.location ?? (box.inFreezer ? L("Freezer") : L("Fridge"))].joined(separator: " · "))
                    .font(.caption).foregroundStyle(Theme.ink3)
            }
            Spacer(minLength: 0)
            if let l = BoxText.due(box) { StatusPill(text: l, status: box.state == "ok" ? nil : (box.daysLeft ?? 1) < 0 ? "expired" : "expiring") }
        }
        .contentShape(Rectangle())
    }
}

enum BoxText {
    static func due(_ b: LeftoverBox) -> String? {
        guard let d = b.daysLeft else { return nil }
        if d < 0 { return L("past its date") }
        if d == 0 { return L("today") }
        if d == 1 { return L("1 day left") }
        return LF("%d days left", d)
    }
}

/// One box: what's inside and the one-tap actions (took one / all eaten / thawed / thrown away), with undo.
struct BoxDetail: View {
    let code: String
    let store: ServerStore
    var changed: () -> Void = {}
    @Environment(\.dismiss) private var dismiss
    @State private var box: LeftoverBox?
    @State private var message: String?
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        Form {
            if let b = box {
                Section {
                    HStack(spacing: Theme.Space.s3) {
                        RemoteImage(url: store.api.imageURL(b.imagePath), api: store.api, placeholder: "takeoutbag.and.cup.and.straw")
                            .frame(width: 64, height: 64)
                            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.base))
                        VStack(alignment: .leading, spacing: 3) {
                            Text(b.name).font(.headline)
                            Text([b.portionsLabel, b.location].compactMap { $0 }.joined(separator: " · ")).font(.subheadline).foregroundStyle(Theme.ink2)
                            Text(b.prettyCode).font(.caption.monospaced()).foregroundStyle(Theme.ink3)
                        }
                    }
                    if let d = ServerDate.shortDay(b.eatBy) {
                        LabeledContent(L("Eat by"), value: d)
                    }
                    if let made = ServerDate.shortDay(b.madeOn) { LabeledContent(L("Put away"), value: made) }
                }
                if let message {
                    Section {
                        HStack {
                            Text(message).font(.subheadline)
                            Spacer()
                            if b.canUndo == true { Button(L("Undo")) { Task { await undo() } }.fontWeight(.semibold) }
                        }
                    }
                }
                if b.isActive {
                    Section {
                        if (b.left ?? 0) > 1 { action(L("Took one portion"), "fork.knife", "take") }
                        action(L("All eaten"), "checkmark.circle", "eaten")
                        if b.inFreezer { action(L("Thawed"), "sun.max", "thawed") }
                        action(L("Thrown away"), "trash", "tossed", destructive: true)
                    }
                    Section {
                        Menu {
                            Button(L("Today")) { Task { await plan(0) } }
                            Button(L("Tomorrow")) { Task { await plan(1) } }
                            Button(L("The day after tomorrow")) { Task { await plan(2) } }
                        } label: {
                            Label(L("Plan it"), systemImage: "calendar.badge.plus")
                        }
                    } footer: {
                        Text(b.inFreezer ? L("Planned from the freezer: ToHuus reminds you to take it out in time.") : L("Goes into the week plan."))
                    }
                } else {
                    Section { Text(L("This container is already marked as empty.")).foregroundStyle(Theme.ink3) }
                }
            } else if let error {
                Section { Text(error).foregroundStyle(Theme.empty) }
            } else {
                ProgressView()
            }
        }
        .navigationTitle(L("Box"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Done")) { dismiss() } } }
        .task { await load() }
    }

    private func action(_ title: String, _ icon: String, _ key: String, destructive: Bool = false) -> some View {
        Button(role: destructive ? .destructive : nil) {
            Task { await run(key) }
        } label: {
            Label(title, systemImage: icon)
        }
        .disabled(busy)
    }

    private func load() async {
        do { box = try await store.api.box(code) } catch {
            let e = APIError.from(error)
            self.error = e == .notFound ? L("This label is no longer valid.") : e.localizedDescription
        }
    }

    private func run(_ key: String) async {
        busy = true
        defer { busy = false }
        do {
            let r = try await store.api.boxAction(code, key)
            box = r.box ?? box
            message = r.message
            Haptics.success()
            store.touch("stock", "products")
            changed()
        } catch { message = APIError.from(error).localizedDescription }
    }

    private func undo() async {
        do {
            box = try await store.api.undoBox(code)
            message = L("Undone.")
            store.touch("stock", "products")
            changed()
        } catch { message = APIError.from(error).localizedDescription }
    }

    private func plan(_ inDays: Int) async {
        let day = ServerDate.day(Calendar.current.date(byAdding: .day, value: inDays, to: Date()) ?? Date())
        do {
            try await store.api.planBox(code, day: day)
            Haptics.success()
            message = L("In the week plan.")
            store.touch("recipes")
        } catch { message = APIError.from(error).localizedDescription }
    }
}

/// What a scanned ToHuus QR label points at: a leftover box, a product or a place.
struct LabelSheet: View {
    let raw: String
    let store: ServerStore
    let openProduct: (Int) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var resolved: JSONValue?
    @State private var error: String?

    private var code: String { LabelCode.extract(raw) }

    var body: some View {
        NavigationStack {
            Group {
                if LabelCode.isBox(code) {
                    BoxDetail(code: code, store: store)
                } else {
                    Form {
                        if let r = resolved {
                            other(r)
                        } else if let error {
                            Text(error).foregroundStyle(Theme.empty)
                        } else {
                            ProgressView()
                        }
                    }
                    .navigationTitle(L("Label"))
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Done")) { dismiss() } } }
                    .task { await resolve() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    @ViewBuilder private func other(_ r: JSONValue) -> some View {
        if r["kind"]?.string == "product", let p = r["product"], let id = p["id"]?.int {
            Section {
                Text(p["name"]?.string ?? "").font(.headline)
                if let places = p["places"]?.array, !places.isEmpty {
                    ForEach(Array(places.enumerated()), id: \.offset) { _, pl in
                        Label(pl["name"]?.string ?? "", systemImage: PlaceIcon.symbol(pl["icon"]?.string))
                    }
                }
                if let s = p["spot"]?.string { Label(s, systemImage: "scope").foregroundStyle(Theme.ink2) }
            }
            Section { Button(L("Open product")) { openProduct(id) } }
        } else if r["kind"]?.string == "location", let l = r["location"] {
            Section {
                Label(l["name"]?.string ?? "", systemImage: PlaceIcon.symbol(l["icon"]?.string)).font(.headline)
                if let h = l["hint"]?.string { Text(h).font(.subheadline).foregroundStyle(Theme.ink2) }
            }
            Section(L("In here")) {
                ForEach(Array((r["items"]?.array ?? []).enumerated()), id: \.offset) { _, it in
                    Button(it["name"]?.string ?? "") { if let id = it["id"]?.int { openProduct(id) } }
                }
            }
        } else {
            Text(L("This code isn't a ToHuus label.")).foregroundStyle(Theme.ink3)
        }
    }

    private func resolve() async {
        do { resolved = try await store.api.resolveQR(code) } catch {
            let e = APIError.from(error)
            self.error = e == .notFound ? L("This label is no longer valid.") : e.localizedDescription
        }
    }
}
