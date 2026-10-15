import SwiftUI

// Containers in the week plan (web: Leftovers.tsx PlanBoxPicks, MealBoxAction, SaveBoxSheet): plan a box from the
// fridge or freezer for a day, open the planned box, or put leftovers of a planned meal away with a label.

/// "Reste & Eingefrorenes" in the plan picker: one tap plans the box for that day (POST /labels/boxes/:code/plan).
struct PlanBoxPicksSection: View {
    let store: ServerStore
    let day: String
    let slot: String
    let feedback: CookFeedback
    let onDone: () -> Void
    @State private var boxes: [LeftoverBox] = []

    var body: some View {
        Group {
            if !boxes.isEmpty {
                VStack(alignment: .leading, spacing: Theme.Space.s2) {
                    CookHeading(title: L("Leftovers & frozen"), hint: L("Already cooked – plan it and just warm it up."))
                    VStack(spacing: 0) {
                        ForEach(boxes.prefix(6)) { b in
                            Button { Task { await pick(b) } } label: {
                                HStack(spacing: Theme.Space.s3) {
                                    RemoteImage(url: store.api.imageURL(b.imagePath), api: store.api, placeholder: b.inFreezer ? "snowflake" : "takeoutbag.and.cup.and.straw")
                                        .frame(width: 40, height: 40).clipShape(RoundedRectangle(cornerRadius: Theme.Radius.sm))
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(b.inFreezer ? LF("Use the frozen %@", b.name) : LF("Eat up %@", b.name))
                                            .font(.body.weight(.medium)).foregroundStyle(Theme.ink).multilineTextAlignment(.leading)
                                        Text([b.portionsLabel, BoxText.due(b)].compactMap { $0 }.joined(separator: " · "))
                                            .font(.caption).foregroundStyle(Theme.ink3)
                                    }
                                    Spacer(minLength: 0)
                                    Image(systemName: "plus.circle").foregroundStyle(Theme.primaryText)
                                }
                                .padding(.horizontal, Theme.Space.s3).padding(.vertical, 8)
                                .frame(minHeight: 52)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            Divider()
                        }
                    }
                    .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
                }
            }
        }
        .task { boxes = (try? await store.api.boxes(status: "active")) ?? [] }
    }

    private func pick(_ b: LeftoverBox) async {
        do {
            try await store.api.planBox(b.code, day: day, slot: slot)
            Haptics.success()
            store.touch("recipes", "stock")
            feedback.say(LF("%@ is planned for %@", b.name, CookDay.label(day)))
            onDone()
        } catch { feedback.fail(error) }
    }
}

/// The action row in the meal sheet: the planned box ("box:CODE" in the note) or "put leftovers away".
struct MealBoxActionRow: View {
    let store: ServerStore
    let entry: WeekEntry
    @State private var openCode: String?
    @State private var putAway = false

    private var code: String? {
        guard let n = entry.note, n.hasPrefix("box:") else { return nil }
        return String(n.dropFirst(4))
    }

    var body: some View {
        Button {
            if let code { openCode = code } else { putAway = true }
        } label: {
            HStack(spacing: Theme.Space.s3) {
                Image(systemName: code != nil ? "snowflake" : "takeoutbag.and.cup.and.straw").foregroundStyle(Theme.primaryText).frame(width: 28)
                VStack(alignment: .leading, spacing: 2) {
                    Text(code != nil ? L("Open container") : L("Leftovers")).font(.body.weight(.semibold)).foregroundStyle(Theme.ink)
                    Text(code != nil ? L("Thawed, eaten, took one.") : L("Put away with date and label.")).font(.caption).foregroundStyle(Theme.ink3)
                }
                Spacer()
            }
            .padding(Theme.Space.s3)
            .frame(minHeight: 56)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .sheet(item: Binding(get: { openCode.map { DayRef(day: $0) } }, set: { openCode = $0?.day })) { ref in
            NavigationStack { BoxDetail(code: ref.day, store: store) { store.touch("stock", "recipes") } }
                .presentationDetents([.medium, .large])
        }
        .sheet(isPresented: $putAway) {
            PutAwaySheet(store: store, name: entry.title, recipeId: entry.recipeId, planId: entry.id)
        }
    }
}

/// Leftovers of a meal into containers (fridge or freezer), with an eat-by date and the labels to share or print.
struct PutAwaySheet: View {
    let store: ServerStore
    var name: String
    var recipeId: Int?
    var planId: Int?
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var portions = 2
    @State private var containers = 1
    @State private var place = "fridge"
    @State private var hasFreezer = false
    @State private var hasEatBy = false
    @State private var eatBy = Calendar.current.date(byAdding: .day, value: 3, to: Date()) ?? Date()
    @State private var created: [LeftoverBox] = []
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                if created.isEmpty {
                    Section {
                        TextField(L("What is it?"), text: $title)
                        Stepper(value: $portions, in: 1...20) {
                            HStack { Text(L("Portions")); Spacer(); Text("\(portions)").monospacedDigit().foregroundStyle(Theme.ink2) }
                        }
                        Stepper(value: $containers, in: 1...max(1, min(12, portions))) {
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
                    } footer: {
                        Text(containers > 1 ? L("Each container gets its own code and label.") : L("One container, one label."))
                    }
                    if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
                } else {
                    BoxLabelsSection(store: store, boxes: created)
                }
            }
            .themedList()
            .navigationTitle(created.isEmpty ? L("Put leftovers away") : L("Put away – the labels"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if created.isEmpty {
                    ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } }
                    ToolbarItem(placement: .confirmationAction) {
                        Button(L("Put away")) { Task { await save() } }
                            .disabled(busy || title.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                } else {
                    ToolbarItem(placement: .confirmationAction) { Button(L("Done")) { dismiss() } }
                }
            }
            .task {
                if title.isEmpty { title = name }
                hasFreezer = ((try? await store.api.places()) ?? []).contains { $0.kind == "freezer" }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func save() async {
        busy = true
        defer { busy = false }
        do {
            created = try await store.api.putAwayPlanned(planId: planId, recipeId: recipeId, name: title.trimmingCharacters(in: .whitespaces),
                                                        portions: Double(portions), boxes: containers, place: hasFreezer ? place : "fridge",
                                                        eatBy: hasEatBy ? ServerDate.day(eatBy) : nil)
            Haptics.success()
            store.touch("stock", "products", "recipes")
            error = nil
        } catch { self.error = APIError.from(error).localizedDescription }
    }
}

/// The labels of freshly put-away containers: preview, share (e.g. to a label printer app) or print.
struct BoxLabelsSection: View {
    let store: ServerStore
    let boxes: [LeftoverBox]
    @State private var share: ShareImage?
    @State private var error: String?

    var body: some View {
        Section {
            ForEach(boxes) { b in
                HStack(spacing: Theme.Space.s3) {
                    RemoteImage(url: try? store.api.url("api/labels/boxes/\(b.code)/label.png"), api: store.api, placeholder: "qrcode")
                        .frame(width: 72, height: 72)
                        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.sm))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(b.name).font(.subheadline.weight(.semibold))
                        Text(b.prettyCode).font(.caption.monospaced()).foregroundStyle(Theme.ink2)
                        if let d = ServerDate.shortDay(b.eatBy) { Text(LF("eat by %@", d)).font(.caption).foregroundStyle(Theme.ink3) }
                    }
                    Spacer(minLength: 0)
                    Button { Task { await load(b, print: true) } } label: { Image(systemName: "printer").frame(width: 44, height: 44) }
                        .buttonStyle(.borderless)
                        .accessibilityLabel(L("Print the label"))
                    Button { Task { await load(b, print: false) } } label: { Image(systemName: "square.and.arrow.up").frame(width: 44, height: 44) }
                        .buttonStyle(.borderless)
                        .accessibilityLabel(L("Share the label"))
                }
            }
            if let error { Text(error).font(.caption).foregroundStyle(Theme.empty) }
        } footer: {
            Text(L("Print the label or write the code on the lid. Scanning it later shows what's inside."))
        }
        .sheet(item: $share) { s in ShopActivitySheet(items: [s.image]).presentationDetents([.medium, .large]) }
    }

    private func load(_ b: LeftoverBox, print: Bool) async {
        guard let data = try? await store.api.getData("api/labels/boxes/\(b.code)/label.png"), let img = UIImage(data: data) else {
            error = L("The label couldn't be loaded.")
            return
        }
        if print {
            let pc = UIPrintInteractionController.shared
            let info = UIPrintInfo(dictionary: nil)
            info.outputType = .photo
            info.jobName = b.name
            pc.printInfo = info
            pc.printingItem = img
            pc.present(animated: true, completionHandler: nil)
        } else {
            share = ShareImage(image: img)
        }
    }
}
