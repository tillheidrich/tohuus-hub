import Observation
import SwiftUI

/// Toast + undo shared by the cooking screens.
@MainActor
@Observable
final class CookFeedback {
    var toast: CookToastData?
    @ObservationIgnored var undo: (() async -> Void)?

    func say(_ text: String, undo: (() async -> Void)? = nil) {
        self.undo = undo
        toast = CookToastData(text: text, actionLabel: undo == nil ? nil : L("Undo"))
    }
    func fail(_ error: Error) { say(APIError.from(error).localizedDescription) }
}

/// Week plan (web: pages/Week.tsx + Plan2.tsx): seven days, day marks, who cooks, servings, fill / shift / shop.
@MainActor
@Observable
final class WeekModel {
    var offset = 0
    private(set) var plan: WeekPlan?
    private(set) var overlay: WeekOverlay?
    private(set) var claims: [Int: PlanClaim] = [:]
    /// who probably cooks open meals (server: habits.ts) – shown faded, nothing entered
    private(set) var suggested: [Int: CookSuggestion] = [:]
    private(set) var members: [HouseMember] = []
    private(set) var myId: Int?
    private(set) var loading = false
    var busy = ""
    var error: String?

    var from: String { CookDay.add(CookDay.today(), offset * 7) }
    var days: [String] { plan?.days ?? (0..<7).map { CookDay.add(from, $0) } }
    func entries(_ day: String) -> [WeekEntry] { (plan?.entries ?? []).filter { $0.day == day } }
    func mark(_ day: String) -> PlanDayMark? { overlay?.marks.first { $0.day == day } }
    func entry(_ id: Int) -> WeekEntry? { plan?.entries.first { $0.id == id } }

    func load(_ api: APIClient) async {
        loading = true
        defer { loading = false }
        let f = from
        do {
            async let p = api.weekPlan(from: f)
            async let o = api.weekOverlay(from: f)
            async let c = api.planClaims()
            let plan = try await p
            guard f == from else { return }
            self.plan = plan
            overlay = (try? await o) ?? overlay
            claims = Dictionary(((try? await c) ?? []).map { ($0.refId, $0) }, uniquingKeysWith: { a, _ in a })
            let today = CookDay.today()
            suggested = Dictionary(((try? await api.cookSuggestions(from: max(f, today), to: CookDay.add(f, 6))) ?? []).map { ($0.entryId, $0) }, uniquingKeysWith: { a, _ in a })
            error = nil
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
        if members.isEmpty {
            members = (try? await api.houseMembers()) ?? []
            myId = await api.myUserId()
        }
    }

    /// optimistic local change, server afterwards
    func setLocalDay(_ id: Int, _ day: String) {
        if let i = plan?.entries.firstIndex(where: { $0.id == id }) { plan?.entries[i].day = day }
    }
    func setLocalCooked(_ id: Int, _ on: Bool) {
        if let i = plan?.entries.firstIndex(where: { $0.id == id }) { plan?.entries[i].cooked = .bool(on) }
    }
}

struct WeekPlanSection: View {
    let store: ServerStore
    let model: WeekModel
    let feedback: CookFeedback
    let openRecipe: (RecipeRef) -> Void
    @Environment(AppModel.self) private var app
    @State private var pickDay: String?
    @State private var meal: WeekEntry?
    @State private var showRotation = false
    @State private var showVotes = false
    @State private var dropTarget: String?
    @State private var showBoard = false
    @State private var cookidoo: CookidooStatus?

    private var today: String { CookDay.today() }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s3) {
            header
            if model.plan != nil { WeekGlanceCard(model: model) { showBoard = true } }
            if let error = model.error { ErrorBanner(message: error) { Task { await model.load(store.api) } } }
            if model.plan == nil && model.loading {
                ProgressView().frame(maxWidth: .infinity).padding(.vertical, 40)
            } else {
                ForEach(model.days, id: \.self) { day in dayCard(day) }
            }
            actions
        }
        .task(id: "\(store.revision("recipes"))-\(model.offset)") { await model.load(store.api) }
        .sheet(item: Binding(get: { pickDay.map { DayRef(day: $0) } }, set: { pickDay = $0?.day })) { ref in
            PlanPickerSheet(store: store, day: ref.day, mark: model.mark(ref.day), feedback: feedback) {
                Task { await model.load(store.api) }
            }
        }
        .sheet(item: $meal) { e in
            MealSheet(store: store, model: model, feedback: feedback, entryId: e.id, openRecipe: { ref in
                meal = nil
                openRecipe(ref)
            })
        }
        .sheet(isPresented: $showRotation) { RotationSheet(store: store, from: model.from, feedback: feedback) { Task { await model.load(store.api) } } }
        .sheet(isPresented: $showVotes) { VotesSheet(store: store) { Task { await model.load(store.api) } } }
        .sheet(isPresented: $showBoard, onDismiss: { Task { await model.load(store.api) } }) {
            PlanBoardSheet(store: store, model: model)
        }
        .task { if !app.isCloud { cookidoo = try? await store.api.cookidooStatus() } }
    }

    private var header: some View {
        HStack {
            Button { model.offset -= 1 } label: { Image(systemName: "chevron.left").frame(width: 44, height: 44) }
                .disabled(model.offset <= 0)
                .accessibilityLabel(LC("Previous week"))
            Spacer()
            Text(model.offset == 0 ? LC("from today") : LCF("from %@", CookDay.short(model.from)))
                .font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink2)
            Spacer()
            Button { model.offset += 1 } label: { Image(systemName: "chevron.right").frame(width: 44, height: 44) }
                .accessibilityLabel(LC("Next week"))
        }
    }

    private func dayCard(_ day: String) -> some View {
        let list = model.entries(day)
        let mark = model.mark(day)
        return VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .center) {
                Text(day == today ? LC("Today") : CookDay.weekday(day)).font(.subheadline.weight(.bold))
                    .foregroundStyle(day == today ? Theme.primaryText : Theme.ink)
                Text(CookDay.dayOfMonth(day)).font(.subheadline.monospacedDigit()).foregroundStyle(Theme.ink3)
                Spacer()
                if let mark {
                    Label(mark.label + (mark.note.map { " · \($0)" } ?? ""), systemImage: mark.kind == "out" ? "fork.knife" : "house.slash")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(Theme.info)
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(Theme.infoSoft, in: Capsule())
                }
                if list.isEmpty && day >= today {
                    Button { pickDay = day } label: {
                        Label(LC("plan"), systemImage: "plus").font(.subheadline.weight(.semibold))
                            .padding(.horizontal, 12).frame(minHeight: 36)
                            .background(Theme.primarySoft, in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(Theme.primaryText)
                    .padding(.leading, mark == nil ? 0 : 6)
                }
            }
            ForEach(list) { e in mealRow(e) }
            if day >= today && !list.isEmpty {
                Button { pickDay = day } label: {
                    Label(LC("add more"), systemImage: "plus")
                        .font(.subheadline.weight(.medium))
                        .frame(maxWidth: .infinity, minHeight: 40, alignment: .leading)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .foregroundStyle(Theme.primaryText)
            }
        }
        .padding(Theme.Space.s3)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(dropTarget == day ? Theme.primarySoft : Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
        .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).stroke(day == today ? Theme.primary.opacity(0.6) : Theme.line, lineWidth: 1))
        .opacity(day < today ? 0.7 : 1)
        .dropDestination(for: String.self) { items, _ in
            guard day >= today else { return false }
            if let r = items.compactMap(RecipeDrag.init(payload:)).first {
                Task {
                    do { try await store.api.planEntry(day: day, recipeId: r.id, title: nil, servings: nil); Haptics.success() } catch { feedback.fail(error) }
                    await model.load(store.api)
                }
                return true
            }
            guard let id = items.compactMap(PlanDrag.init(payload:)).first?.id else { return false }
            Task { await move(id, to: day) }
            return true
        } isTargeted: { on in dropTarget = on ? day : (dropTarget == day ? nil : dropTarget) }
    }

    private func subline(_ e: WeekEntry) -> String {
        var parts: [String] = []
        if e.isLunch { parts.append(LC("Lunch")) }
        switch e.source {
        case "cookidoo": parts.append("Cookidoo")
        case "suggest": parts.append(LC("Suggested"))
        case "rotation": parts.append(LC("Rotation"))
        case "vote": parts.append(LC("Voted"))
        default: break
        }
        if e.isThermomix { parts.append("TM") }
        if let s = e.servings, s != e.baseServings { parts.append(LCF("for %d", s)) }
        return parts.joined(separator: " · ")
    }

    private func mealRow(_ e: WeekEntry) -> some View {
        HStack(spacing: Theme.Space.s3) {
            Button { meal = e } label: {
                HStack(spacing: Theme.Space.s3) {
                    RemoteImage(url: store.api.imageURL(e.imagePath), api: store.api, placeholder: e.recipeId == nil ? "takeoutbag.and.cup.and.straw" : "fork.knife")
                        .frame(width: 44, height: 44)
                        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.sm))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(e.title).font(Theme.rowFont).foregroundStyle(Theme.ink)
                            .strikethrough(e.isCooked, color: Theme.ink3)
                            .multilineTextAlignment(.leading)
                        let s = subline(e)
                        if !s.isEmpty { Text(s).font(.caption).foregroundStyle(Theme.ink3) }
                    }
                    Spacer(minLength: 0)
                    if let c = model.claims[e.id] {
                        PersonDot(name: c.name, color: c.color, size: 24)
                            .accessibilityLabel(LCF("%@ cooks", c.name))
                    } else if let s = model.suggested[e.id] {
                        PersonDot(name: s.name, color: s.color, size: 24)
                            .opacity(0.5)
                            .overlay(Circle().strokeBorder(Theme.ink3, style: StrokeStyle(lineWidth: 1.5, dash: [3, 2])))
                            .accessibilityLabel(LF("Probably %@ cooks", s.name))
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            Button { Task { await toggleCooked(e) } } label: {
                Image(systemName: e.isCooked ? "checkmark.circle.fill" : "circle")
                    .font(.title3)
                    .foregroundStyle(e.isCooked ? Theme.primary : Theme.ink3)
                    .frame(width: 44, height: 44)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(e.isCooked ? LC("Mark as not cooked") : LC("Mark as cooked"))
        }
        .draggable(PlanDrag(id: e.id).payload) {
            Text(e.title).padding(8).background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.sm))
        }
    }

    /// "Mo., 13.10.: Linsensuppe, Salat" – one line per planned day; nil when nothing is planned
    private var planShareText: String? {
        let lines = model.days.compactMap { day -> String? in
            let titles = model.entries(day).map(\.title)
            return titles.isEmpty ? nil : "– " + CookDay.short(day) + ": " + titles.joined(separator: ", ")
        }
        guard !lines.isEmpty else { return nil }
        return ShareText.make(title: LF("Our week plan from %@", CookDay.short(model.from)), lines: lines, medium: "plan")
    }

    private var actions: some View {
        VStack(spacing: Theme.Space.s3) {
            Button { Task { await fillWeek() } } label: {
                HStack {
                    Label(model.busy == "fill" ? LC("Planning…") : LC("Fill the week"), systemImage: "wand.and.stars")
                    if !plusAvailable { Text("Plus").font(.caption2.weight(.bold)).padding(.horizontal, 6).padding(.vertical, 2).background(Theme.mustard, in: Capsule()).foregroundStyle(Theme.ink) }
                }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(!model.busy.isEmpty)
            Text(LC("Fills free evenings with what you can cook from what's at home. Nothing planned gets overwritten."))
                .font(.caption).foregroundStyle(Theme.ink3)
            HStack(spacing: Theme.Space.s3) {
                Button { Task { await shop() } } label: { Label(LC("Shop for the week"), systemImage: "cart.badge.plus") }
                    .buttonStyle(SecondaryButtonStyle())
                    .disabled(!model.busy.isEmpty || (model.plan?.entries.isEmpty ?? true))
                Button { showRotation = true } label: {
                    Label(rotationLabel, systemImage: "repeat").lineLimit(1)
                }
                .buttonStyle(SecondaryButtonStyle())
            }
            if let text = planShareText {
                // the week plan to Notes, Mail or the family chat – plain text
                ShareLink(item: text, subject: Text(L("Our week plan"))) {
                    Label(L("Share the week plan"), systemImage: "square.and.arrow.up")
                }
                .buttonStyle(SecondaryButtonStyle())
            }
            Button { showVotes = true } label: {
                Label((model.overlay?.votes ?? 0) > 0 ? LCF("Who wants what? · %d open", model.overlay?.votes ?? 0) : LC("Who wants what?"), systemImage: "person.3")
            }
            .buttonStyle(SecondaryButtonStyle())
            HStack(spacing: Theme.Space.s3) {
                if cookidoo?.pull == true {
                    Button { Task { await syncCookidoo() } } label: {
                        Label(model.busy == "cdo" ? L("Checking Cookidoo…") : L("Sync Cookidoo"), systemImage: "arrow.triangle.2.circlepath").lineLimit(1)
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    .disabled(!model.busy.isEmpty)
                }
                CookPrintMenu(store: store, ticketType: "week", ticketDay: model.from, title: L("Meal plan"),
                              html: { CookPrint.weekHTML(CookPrint.weekRows(model), from: model.from) },
                              text: { CookPrint.weekText(CookPrint.weekRows(model), from: model.from) },
                              feedback: feedback) {
                    Label(L("Print or share week"), systemImage: "printer")
                        .lineLimit(1)
                        .font(.body.weight(.semibold))
                        .foregroundStyle(Theme.primaryText)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 13)
                        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
                        .overlay(RoundedRectangle(cornerRadius: Theme.Radius.base).stroke(Theme.lineStrong, lineWidth: 1))
                }
            }
            if let push = cookidoo?.push, let at = push.at {
                Label(LF("Cookidoo week last received %@: %d dishes", ServerDate.relative(at) ?? at, push.events ?? 0), systemImage: "checkmark.circle")
                    .font(.caption).foregroundStyle(Theme.ink3)
            }
            Text(LC("Drag a meal to another day, or tap it for more."))
                .font(.footnote).foregroundStyle(Theme.ink3)
        }
        .padding(.top, Theme.Space.s2)
    }

    private var rotationLabel: String {
        guard let rot = model.overlay?.rotation, !rot.templateIds.isEmpty else { return LC("Plan templates") }
        let next = rot.weeks.first { $0.monday > today }
        return LC("Rotation") + (next?.name.map { " · \($0)" } ?? "")
    }

    /// Plus: "week plan from the pantry" (limits.features.weekPlanFromPantry); self-hosted servers have everything.
    private var plusAvailable: Bool {
        app.billing?.limits?["features"]?["weekPlanFromPantry"]?.bool ?? true
    }

    private func fillWeek() async {
        guard plusAvailable else { app.openPaywall("week_plan"); return }
        model.busy = "fill"
        defer { model.busy = "" }
        do {
            let n = try await store.api.autofillWeek(from: model.from)
            feedback.say(n == 0 ? LC("Every evening is already planned") : n == 1 ? LC("Filled 1 evening with ideas from your pantry") : LCF("Filled %d evenings with ideas from your pantry", n))
            Haptics.success()
            store.touch("recipes")
        } catch {
            if case .quota = APIError.from(error) { app.openPaywall("week_plan") } else { feedback.fail(error) }
        }
        await model.load(store.api)
    }

    private func shop() async {
        model.busy = "shop"
        defer { model.busy = "" }
        do {
            let n = try await store.api.shopForWeek(from: model.from)
            store.touch("shopping")
            await store.refreshList()
            feedback.say(n == 0 ? LC("All set – nothing missing for the week") : n == 1 ? LC("Added 1 ingredient to the shopping list") : LCF("Added %d ingredients to the shopping list", n))
        } catch { feedback.fail(error) }
    }

    private func syncCookidoo() async {
        model.busy = "cdo"
        defer { model.busy = "" }
        do {
            let r = try await store.api.cookidooSync()
            if let err = r.error, !err.isEmpty { feedback.say(err) } else {
                let n = r.added ?? 0
                feedback.say(n == 0 ? LF("Cookidoo synced – %d entries, nothing new", r.events ?? 0) : n == 1 ? L("Imported 1 meal from Cookidoo") : LF("Imported %d meals from Cookidoo", n))
                store.touch("recipes")
            }
        } catch { feedback.fail(error) }
        await model.load(store.api)
    }

    private func toggleCooked(_ e: WeekEntry) async {
        model.setLocalCooked(e.id, !e.isCooked)
        Haptics.tick()
        do { try await store.api.setPlanCooked(e.id, !e.isCooked) } catch { feedback.fail(error) }
        await model.load(store.api)
    }

    private func move(_ id: Int, to day: String) async {
        guard let e = model.entry(id), e.day != day else { return }
        let prev = e.day
        model.setLocalDay(id, day)
        do {
            try await store.api.movePlan(id, day: day)
            Haptics.tick()
            feedback.say(LCF("Moved to %@", CookDay.label(day))) {
                try? await store.api.movePlan(id, day: prev)
                await model.load(store.api)
            }
        } catch { feedback.fail(error) }
        await model.load(store.api)
    }
}

struct DayRef: Identifiable, Hashable { let day: String; var id: String { day } }

// MARK: - meal sheet

/// Everything you do with a planned dish (web: MealSheet): who cooks, servings, tomorrow, eating out, another day.
struct MealSheet: View {
    let store: ServerStore
    let model: WeekModel
    let feedback: CookFeedback
    let entryId: Int
    let openRecipe: (RecipeRef) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var servings: Int?

    private var today: String { CookDay.today() }

    var body: some View {
        NavigationStack {
            if let e = model.entry(entryId) {
                content(e)
            } else {
                EmptyStateView(systemImage: "calendar", title: LC("This meal is no longer in the plan."))
            }
        }
        .presentationDetents([.large])
    }

    private func content(_ e: WeekEntry) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.s4) {
                if e.imagePath != nil {
                    RemoteImage(url: store.api.imageURL(e.imagePath), api: store.api, placeholder: "fork.knife")
                        .frame(height: 160).frame(maxWidth: .infinity)
                        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.lg))
                }
                Text("\(CookDay.label(e.day)) · \(e.isLunch ? LC("lunch") : LC("dinner"))")
                    .font(.subheadline).foregroundStyle(Theme.ink2)
                cookPicker(e)
                if e.recipeId != nil {
                    let base = e.baseServings ?? 4
                    let cur = servings ?? e.servings ?? base
                    ServingsStepper(value: cur,
                                    label: cur == 1 ? LC("For 1 person") : LCF("For %d people", cur),
                                    detail: (e.servings ?? servings) != nil && cur != base ? LCF("Usually %d – just this once", base) : (e.baseServings == nil ? LC("The recipe has no servings – amounts stay as written") : LC("As usual")),
                                    reset: cur != base ? { Task { await setServings(e, nil) } } : nil) { n in
                        Task { await setServings(e, n == base ? nil : n) }
                    }
                }
                Button { Task { await toggleCooked(e) } } label: {
                    Label(e.isCooked ? LC("Mark as not cooked") : LC("Mark as cooked"), systemImage: e.isCooked ? "arrow.uturn.backward" : "checkmark")
                }
                .buttonStyle(SecondaryButtonStyle())
                VStack(spacing: 0) {
                    let tomorrow = CookDay.add(e.day < today ? today : e.day, 1)
                    action(LC("Move to tomorrow"), CookDay.label(tomorrow), "arrow.right") { await move(e, tomorrow) }
                    Divider()
                    action(LC("We’re eating out"), LC("This and every meal after it moves back a day."), "fork.knife") { await shift(e) }
                    if let rid = e.recipeId {
                        Divider()
                        action(LC("Open recipe"), LC("Ingredients, steps, mark as cooked."), "book") { openRecipe(RecipeRef(id: rid, planEntryId: e.id)) }
                    }
                    Divider()
                    MealBoxActionRow(store: store, entry: e)
                    Divider()
                    action(LC("Remove from plan"), LC("The recipe stays in your collection."), "trash", tint: Theme.empty) { await remove(e) }
                }
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
                .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).stroke(Theme.line, lineWidth: 1))

                CookHeading(title: LC("Another day"))
                Button { Task { await move(e, CookDay.add(e.day, 7)) } } label: {
                    Label(LC("Same day next week"), systemImage: "arrow.right").font(.subheadline.weight(.medium))
                }
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach((0..<14).map { CookDay.add(today, $0) }, id: \.self) { d in
                            Button { Task { await move(e, d) } } label: {
                                VStack(spacing: 2) {
                                    Text(d == today ? LC("Today") : CookDay.weekday(d)).font(.caption.weight(.semibold))
                                    Text(CookDay.dayOfMonth(d)).font(.subheadline.monospacedDigit())
                                }
                                .frame(width: 52, height: 52)
                                .foregroundStyle(d == e.day ? Theme.onPrimary : Theme.ink)
                                .background(d == e.day ? Theme.primary : Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
                                .overlay(RoundedRectangle(cornerRadius: Theme.Radius.base).stroke(Theme.line, lineWidth: d == e.day ? 0 : 1))
                            }
                            .buttonStyle(.plain)
                            .disabled(d == e.day)
                        }
                    }
                }
            }
            .padding(Theme.Space.s4)
        }
        .canvasBackground()
        .navigationTitle(e.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Close")) { dismiss() } } }
    }

    @ViewBuilder
    private func cookPicker(_ e: WeekEntry) -> some View {
        if model.members.count > 1 {
            let claim = model.claims[e.id]
            VStack(alignment: .leading, spacing: 8) {
                Label(claim.map { LCF("%@ cooks", $0.name) } ?? LC("Who cooks?"), systemImage: "hand.raised")
                    .font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink2)
                if claim == nil, let s = model.suggested[e.id] {
                    Text(s.why == "weekday" ? LF("%@ usually cooks on this weekday.", s.name) : LF("%@ has cooked most of the time lately.", s.name))
                        .font(.footnote).foregroundStyle(Theme.ink3)
                }
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: Theme.Space.s3) {
                        ForEach(model.members) { m in
                            let on = claim?.userId == m.id
                            Button { Task { await setCook(e, m, !on) } } label: {
                                VStack(spacing: 4) {
                                    PersonDot(name: m.name, color: m.color, size: 40)
                                        .overlay(Circle().stroke(on ? Theme.primary : .clear, lineWidth: 3).padding(-3))
                                        .overlay(Circle().strokeBorder(claim == nil && model.suggested[e.id]?.userId == m.id ? Theme.primary : .clear,
                                                                       style: StrokeStyle(lineWidth: 1.5, dash: [4, 3])).padding(-4))
                                    Text(m.id == model.myId ? LC("Me") : m.name).font(.caption).foregroundStyle(on ? Theme.primaryText : Theme.ink2)
                                }
                                .frame(minWidth: 52)
                            }
                            .buttonStyle(.plain)
                            .accessibilityAddTraits(on ? .isSelected : [])
                        }
                    }
                    .padding(4)
                }
            }
        }
    }

    private func action(_ title: String, _ detail: String, _ icon: String, tint: Color = Theme.primaryText, run: @escaping () async -> Void) -> some View {
        Button { Task { await run() } } label: {
            HStack(spacing: Theme.Space.s3) {
                Image(systemName: icon).foregroundStyle(tint).frame(width: 28)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.body.weight(.semibold)).foregroundStyle(Theme.ink)
                    Text(detail).font(.caption).foregroundStyle(Theme.ink3)
                }
                Spacer()
            }
            .padding(Theme.Space.s3)
            .frame(minHeight: 56)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func setCook(_ e: WeekEntry, _ m: HouseMember, _ on: Bool) async {
        do { try await store.api.setCook(entry: e.id, userId: m.id, on: on); Haptics.tick() } catch { feedback.fail(error) }
        await model.load(store.api)
    }

    private func setServings(_ e: WeekEntry, _ n: Int?) async {
        servings = n ?? e.baseServings
        do { try await store.api.setEntryServings(e.id, n); store.touch("shopping") } catch { feedback.fail(error) }
        await model.load(store.api)
        servings = nil
    }

    private func toggleCooked(_ e: WeekEntry) async {
        do { try await store.api.setPlanCooked(e.id, !e.isCooked); Haptics.success() } catch { feedback.fail(error) }
        await model.load(store.api)
    }

    private func move(_ e: WeekEntry, _ day: String) async {
        let prev = e.day, id = e.id, api = store.api
        do {
            try await api.movePlan(id, day: day)
            feedback.say(LCF("Moved to %@", CookDay.label(day))) {
                try? await api.movePlan(id, day: prev)
                await model.load(api)
            }
            dismiss()
        } catch { feedback.fail(error) }
        await model.load(api)
    }

    private func shift(_ e: WeekEntry) async {
        let api = store.api, day = e.day, slot = e.slot
        do {
            let n = try await api.shiftPlan(from: day, by: 1, slot: slot)
            if n > 0 {
                feedback.say(n == 1 ? LC("1 meal moved back a day") : LCF("%d meals moved back a day", n)) {
                    _ = try? await api.shiftPlan(from: CookDay.add(day, 1), by: -1, slot: slot)
                    await model.load(api)
                }
            } else { feedback.say(LC("Nothing to move")) }
            dismiss()
        } catch { feedback.fail(error) }
        await model.load(api)
    }

    private func remove(_ e: WeekEntry) async {
        let api = store.api
        do {
            try await api.deletePlan(e.id)
            feedback.say(LCF("Removed “%@” from the plan", e.title)) {
                try? await api.planEntry(day: e.day, slot: e.slot ?? "abend", recipeId: e.recipeId, title: e.title, servings: e.servings, note: e.note)
                await model.load(api)
            }
            dismiss()
        } catch { feedback.fail(error) }
        await model.load(api)
    }
}

// MARK: - plan picker

/// "Was gibt es am …?" – day mark, lunch/dinner, servings, search or free text, pantry matches, vote.
struct PlanPickerSheet: View {
    let store: ServerStore
    let day: String
    let mark: PlanDayMark?
    let feedback: CookFeedback
    let onDone: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var q = ""
    @State private var slot = "abend"
    @State private var servings: Int?
    @State private var ideas: [CookIdea] = []
    @State private var recipes: [Recipe] = []
    @State private var currentMark: String?
    @State private var showVote = false
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Space.s4) {
                    markChips
                    Picker("", selection: $slot) {
                        Text(LC("Dinner")).tag("abend")
                        Text(LC("Lunch")).tag("mittag")
                    }
                    .pickerStyle(.segmented)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(LC("For how many?")).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink2)
                        FlowLayout {
                            ForEach([0, 2, 3, 4, 5, 6, 8], id: \.self) { n in
                                CookChip(title: n == 0 ? LC("as usual") : "\(n)", on: (servings ?? 0) == n) { servings = n == 0 ? nil : n }
                            }
                        }
                    }
                    TextField(LC("Search recipes or type anything (“order pizza”)"), text: $q)
                        .focused($focused)
                        .submitLabel(.done)
                        .onSubmit { if !q.trimmingCharacters(in: .whitespaces).isEmpty { Task { await add(recipe: nil, title: q.trimmingCharacters(in: .whitespaces)) } } }
                        .padding(12)
                        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
                        .overlay(RoundedRectangle(cornerRadius: Theme.Radius.base).stroke(Theme.line, lineWidth: 1))
                    let n = q.trimmingCharacters(in: .whitespaces)
                    if !n.isEmpty {
                        let hits = recipes.filter { $0.title.range(of: n, options: [.caseInsensitive, .diacriticInsensitive]) != nil }.prefix(8)
                        VStack(spacing: 0) {
                            ForEach(Array(hits)) { r in
                                row(icon: "fork.knife", title: r.title, detail: nil) { await add(recipe: r.id, title: nil) }
                                Divider()
                            }
                            row(icon: "plus", title: LCF("Add “%@”", n), detail: LC("Free text – no recipe needed")) { await add(recipe: nil, title: n) }
                        }
                        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
                    } else {
                        CookHeading(title: LC("Matches your pantry"))
                        if ideas.isEmpty {
                            Text(LC("No ideas yet – type a dish or anything you like.")).font(.subheadline).foregroundStyle(Theme.ink3)
                        }
                        VStack(spacing: 0) {
                            ForEach(ideas.prefix(8)) { i in
                                row(image: i.image, title: i.title, detail: ideaDetail(i)) { await add(recipe: i.recipeId, title: nil) }
                                Divider()
                            }
                        }
                        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
                        PlanBoxPicksSection(store: store, day: day, slot: slot, feedback: feedback) { onDone(); dismiss() }
                        Button { showVote = true } label: { Label(LC("Can’t decide? Let everyone vote"), systemImage: "person.3") }
                            .buttonStyle(SecondaryButtonStyle())
                    }
                }
                .padding(Theme.Space.s4)
            }
            .canvasBackground()
            .navigationTitle(LCF("What’s on for %@?", CookDay.long(day)))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } } }
            .task {
                currentMark = mark?.kind
                async let i = store.api.cookIdeas()
                async let r = store.api.recipes()
                ideas = (try? await i) ?? []
                recipes = (try? await r) ?? []
            }
            .sheet(isPresented: $showVote) { StartVoteSheet(store: store, day: day) { onDone(); dismiss() } }
        }
        .presentationDetents([.large])
    }

    private func ideaDetail(_ i: CookIdea) -> String {
        var parts: [String] = []
        if let h = i.have, let n = i.need { parts.append(LCF("%d/%d on hand", h, n)) }
        parts.append(contentsOf: i.reasons.prefix(2))
        return parts.joined(separator: " · ")
    }

    @ViewBuilder private var markChips: some View {
        if mark?.source == "away" {
            Label(LC("Vacation mode is on for this day – nothing gets planned automatically."), systemImage: "house")
                .font(.subheadline).foregroundStyle(Theme.info)
        } else {
            FlowLayout {
                CookChip(title: LC("We’re home"), systemImage: "house", on: currentMark == nil) { Task { await setMark(nil) } }
                CookChip(title: LC("Eating out"), systemImage: "fork.knife", on: currentMark == "out") { Task { await setMark("out") } }
                CookChip(title: LC("Not at home"), systemImage: "xmark", on: currentMark == "away") { Task { await setMark("away") } }
            }
        }
    }

    private func setMark(_ kind: String?) async {
        let prev = currentMark
        currentMark = kind
        do { try await store.api.setDayMark(day, kind: kind); onDone() } catch { currentMark = prev; feedback.fail(error) }
    }

    private func row(icon: String? = nil, image: String? = nil, title: String, detail: String?, run: @escaping () async -> Void) -> some View {
        Button { Task { await run() } } label: {
            HStack(spacing: Theme.Space.s3) {
                if let icon {
                    Image(systemName: icon).foregroundStyle(Theme.primaryText).frame(width: 40, height: 40)
                } else {
                    RemoteImage(url: store.api.imageURL(image), api: store.api, placeholder: "fork.knife")
                        .frame(width: 40, height: 40).clipShape(RoundedRectangle(cornerRadius: Theme.Radius.sm))
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.body.weight(.medium)).foregroundStyle(Theme.ink).multilineTextAlignment(.leading)
                    if let detail, !detail.isEmpty { Text(detail).font(.caption).foregroundStyle(Theme.ink3).multilineTextAlignment(.leading) }
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, Theme.Space.s3).padding(.vertical, 8)
            .frame(minHeight: 52)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func add(recipe: Int?, title: String?) async {
        do {
            try await store.api.planEntry(day: day, slot: slot, recipeId: recipe, title: title, servings: recipe == nil ? nil : servings)
            Haptics.success()
            store.touch("recipes")
            onDone()
            dismiss()
        } catch { feedback.fail(error) }
    }
}
