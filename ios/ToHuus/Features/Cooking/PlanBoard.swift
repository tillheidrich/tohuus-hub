import SwiftUI

/// Drag payload for a recipe card ("tohuus-recipe:<id>") – dropped on a day it gets planned.
struct RecipeDrag {
    let id: Int
    var payload: String { "tohuus-recipe:\(id)" }
    init(id: Int) { self.id = id }
    init?(payload: String) {
        guard payload.hasPrefix("tohuus-recipe:"), let n = Int(payload.dropFirst(14)) else { return nil }
        id = n
    }
}

// MARK: - week at a glance

/// Top of the week plan: how much is planned, who still needs a cook, and the way into the planning board
/// (Lilara's "planned / total" and "meals still need a cook", without the guilt).
struct WeekGlanceCard: View {
    let model: WeekModel
    let openBoard: () -> Void

    private var today: String { CookDay.today() }
    private var futureDays: [String] { model.days.filter { $0 >= today } }

    var body: some View {
        let days = futureDays
        let planned = days.filter { !model.entries($0).isEmpty }.count
        let marked = days.filter { model.entries($0).isEmpty && model.mark($0) != nil }.count
        let open = days.count - planned - marked
        let needCook = model.members.count > 1
            ? (model.plan?.entries ?? []).filter { $0.day >= today && !$0.isCooked && model.claims[$0.id] == nil }.count : 0
        return VStack(alignment: .leading, spacing: Theme.Space.s3) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(days.isEmpty ? L("This week is over") : planned == days.count - marked && planned > 0
                         ? L("The week is planned") : LF("%d of %d days planned", planned, max(0, days.count - marked)))
                        .font(.headline).foregroundStyle(Theme.ink)
                    Text(open > 0 ? (open == 1 ? L("1 day is still open") : LF("%d days are still open", open)) : L("Nothing open – enjoy."))
                        .font(.caption).foregroundStyle(Theme.ink3)
                }
                Spacer()
            }
            HStack(spacing: 6) {
                ForEach(model.days, id: \.self) { d in
                    let has = !model.entries(d).isEmpty
                    let mark = model.mark(d) != nil
                    VStack(spacing: 3) {
                        Circle()
                            .fill(has ? Theme.primary : mark ? Theme.info.opacity(0.5) : Color.clear)
                            .overlay(Circle().stroke(has ? Color.clear : Theme.lineStrong, lineWidth: 1.5))
                            .frame(width: 14, height: 14)
                        Text(String(CookDay.weekday(d).prefix(2))).font(.caption2.weight(d == today ? .bold : .regular))
                            .foregroundStyle(d == today ? Theme.primaryText : Theme.ink3)
                    }
                    .frame(maxWidth: .infinity)
                    .opacity(d < today ? 0.5 : 1)
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(LF("%d of %d days planned", planned, model.days.count))
            if needCook > 0 {
                Label(needCook == 1 ? L("1 meal still needs someone at the stove.") : LF("%d meals still need someone at the stove.", needCook), systemImage: "frying.pan")
                    .font(.caption).foregroundStyle(Theme.ink2)
            }
            Button(action: openBoard) {
                Label(L("Plan the week – drag dishes onto days"), systemImage: "square.grid.3x1.below.line.grid.1x2")
                    .font(.subheadline.weight(.semibold))
                    .frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.plain)
            .foregroundStyle(Theme.primaryText)
            .background(Theme.primarySoft, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
        }
        .padding(Theme.Space.s3)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
        .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).stroke(Theme.line, lineWidth: 1))
    }
}

// MARK: - planning board

/// "Woche planen": the seven days on top, your dishes in a tray below. Drag a dish onto a day (or tap a dish, then a
/// day – works with VoiceOver too), drag planned dishes between days, long-press for more. Everyone in the household
/// sees the same plan right away.
struct PlanBoardSheet: View {
    let store: ServerStore
    let model: WeekModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var feedback = CookFeedback()
    @State private var recipes: [RecipeCard] = []
    @State private var ideas: [CookIdea] = []
    @State private var tray = 0
    @State private var query = ""
    @State private var selected: Int?
    @State private var dropTarget: String?

    private var today: String { CookDay.today() }

    /// the dish tapped in the tray (still known when the tray tab changes)
    private var selectedItem: TrayItem? {
        guard let id = selected else { return nil }
        if let it = items.first(where: { $0.id == id }) { return it }
        if let r = recipes.first(where: { $0.id == id }) { return TrayItem(id: r.id, title: r.title, image: r.imagePath) }
        if let i = ideas.first(where: { $0.recipeId == id }) { return TrayItem(id: i.recipeId, title: i.title, image: i.image) }
        return nil
    }

    struct TrayItem: Identifiable, Hashable {
        var id: Int
        var title: String
        var image: String?
        var detail: String?
    }

    private var items: [TrayItem] {
        let q = query.trimmingCharacters(in: .whitespaces)
        var list: [TrayItem]
        switch tray {
        case 0:
            list = ideas.map { i in
                TrayItem(id: i.recipeId, title: i.title, image: i.image,
                         detail: i.missing.isEmpty ? L("Everything is at home") : LF("Missing: %@", i.missing.map(\.name).joined(separator: ", ")))
            }
        case 1:
            list = recipes.filter(\.isFavorite).map { TrayItem(id: $0.id, title: $0.title, image: $0.imagePath, detail: $0.timeMin.map { LF("%d min", Int($0)) }) }
        default:
            list = recipes.map { TrayItem(id: $0.id, title: $0.title, image: $0.imagePath, detail: $0.timeMin.map { LF("%d min", Int($0)) }) }
        }
        if !q.isEmpty { list = list.filter { $0.title.range(of: q, options: [.caseInsensitive, .diacriticInsensitive]) != nil } }
        return list
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                weekHeader
                ScrollView {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: sizeClass == .regular ? 220 : 300), spacing: Theme.Space.s3)], spacing: Theme.Space.s3) {
                        ForEach(model.days, id: \.self) { d in dayCell(d) }
                    }
                    .padding(Theme.Space.s4)
                }
                trayView
            }
            .canvasBackground()
            .navigationTitle(L("Plan the week"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Done")) { dismiss() } } }
            .task {
                async let r = store.api.recipeCards()
                async let i = store.api.cookIdeas()
                recipes = (try? await r) ?? []
                ideas = (try? await i) ?? []
                if ideas.isEmpty { tray = 2 }
            }
            .cookToast($feedback.toast, bottom: 210) { Task { await feedback.undo?() } }
        }
    }

    private var weekHeader: some View {
        HStack {
            Button { model.offset -= 1; Task { await model.load(store.api) } } label: { Image(systemName: "chevron.left").frame(width: 44, height: 44) }
                .disabled(model.offset <= 0)
                .accessibilityLabel(L("Previous week"))
            Spacer()
            Text(model.offset == 0 ? L("from today") : LF("from %@", CookDay.short(model.from)))
                .font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink2)
            Spacer()
            Button { model.offset += 1; Task { await model.load(store.api) } } label: { Image(systemName: "chevron.right").frame(width: 44, height: 44) }
                .accessibilityLabel(L("Next week"))
        }
        .padding(.horizontal, Theme.Space.s3)
        .background(Theme.surface)
        .overlay(alignment: .bottom) { Divider() }
    }

    private func dayCell(_ d: String) -> some View {
        let list = model.entries(d)
        let past = d < today
        let mark = model.mark(d)
        let pick = selectedItem
        return VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(d == today ? L("Today") : CookDay.weekday(d)).font(.subheadline.weight(.bold))
                    .foregroundStyle(d == today ? Theme.primaryText : Theme.ink)
                Text(CookDay.dayOfMonth(d)).font(.subheadline.monospacedDigit()).foregroundStyle(Theme.ink3)
                Spacer()
                if let mark { Text(mark.label).font(.caption).foregroundStyle(Theme.info) }
            }
            ForEach(list) { e in
                HStack(spacing: 8) {
                    RemoteImage(url: store.api.imageURL(e.imagePath), api: store.api, placeholder: e.recipeId == nil ? "takeoutbag.and.cup.and.straw" : "fork.knife")
                        .frame(width: 30, height: 30).clipShape(RoundedRectangle(cornerRadius: 6))
                    Text(e.title).font(.subheadline).foregroundStyle(Theme.ink).lineLimit(2)
                        .strikethrough(e.isCooked, color: Theme.ink3)
                    Spacer(minLength: 0)
                    if let c = model.claims[e.id] { PersonDot(name: c.name, color: c.color, size: 20) }
                }
                .padding(6)
                .background(Theme.surface2, in: RoundedRectangle(cornerRadius: Theme.Radius.sm))
                .draggable(PlanDrag(id: e.id).payload) {
                    Text(e.title).padding(8).background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.sm))
                }
                .contextMenu {
                    Button(role: .destructive) { Task { await remove(e) } } label: { Label(L("Remove from plan"), systemImage: "trash") }
                }
                .accessibilityAction(named: L("Remove from plan")) { Task { await remove(e) } }
            }
            if !past {
                Button {
                    if let p = pick { Task { await plan(p.id, title: p.title, on: d) } }
                } label: {
                    Text(pick.map { LF("Tap to plan “%@” here", $0.title) } ?? (list.isEmpty ? L("Drop a dish here") : L("Drop another dish here")))
                        .font(.caption.weight(pick == nil ? .regular : .semibold))
                        .foregroundStyle(pick == nil ? Theme.ink3 : Theme.primaryText)
                        .frame(maxWidth: .infinity, minHeight: 40)
                        .overlay(RoundedRectangle(cornerRadius: Theme.Radius.sm).strokeBorder(pick == nil ? Theme.line : Theme.primary, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
                }
                .buttonStyle(.plain)
                .disabled(pick == nil)
            }
        }
        .padding(Theme.Space.s3)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(dropTarget == d ? Theme.primarySoft : Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
        .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).stroke(dropTarget == d ? Theme.primary : d == today ? Theme.primary.opacity(0.5) : Theme.line, lineWidth: dropTarget == d ? 2 : 1))
        .opacity(past ? 0.6 : 1)
        .dropDestination(for: String.self) { payloads, _ in
            guard !past, let p = payloads.first else { return false }
            if let r = RecipeDrag(payload: p) {
                let title = recipes.first { $0.id == r.id }?.title ?? ideas.first { $0.recipeId == r.id }?.title ?? ""
                Task { await plan(r.id, title: title, on: d) }
                return true
            }
            if let m = PlanDrag(payload: p) {
                Task { await move(m.id, to: d) }
                return true
            }
            return false
        } isTargeted: { on in dropTarget = on ? d : (dropTarget == d ? nil : dropTarget) }
    }

    private var trayView: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Picker("", selection: $tray) {
                    Text(L("Ideas")).tag(0)
                    Text(L("Favourites")).tag(1)
                    Text(L("All")).tag(2)
                }
                .pickerStyle(.segmented)
                .frame(maxWidth: 320)
                HStack(spacing: 4) {
                    Image(systemName: "magnifyingglass").foregroundStyle(Theme.ink3)
                    TextField(L("Search"), text: $query).autocorrectionDisabled()
                }
                .padding(.horizontal, 8).frame(minHeight: 36)
                .background(Theme.surface2, in: RoundedRectangle(cornerRadius: Theme.Radius.sm))
            }
            let list = items
            if list.isEmpty {
                Text(tray == 1 ? L("No favourites yet – tap the heart on a recipe.") : L("No dishes here yet."))
                    .font(.caption).foregroundStyle(Theme.ink3).frame(height: 120)
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(spacing: 10) {
                        ForEach(list) { it in trayCard(it) }
                    }
                    .padding(.vertical, 2)
                }
                .frame(height: 132)
            }
            Text(selected == nil ? L("Drag a dish onto a day – or tap it, then tap the day.") : L("Now tap a day. Tap the dish again to let go."))
                .font(.caption2).foregroundStyle(Theme.ink3)
        }
        .padding(.horizontal, Theme.Space.s4).padding(.vertical, 10)
        .background(Theme.surface.ignoresSafeArea(edges: .bottom))
        .overlay(alignment: .top) { Divider() }
    }

    private func trayCard(_ it: TrayItem) -> some View {
        let on = selected == it.id
        return Button { selected = on ? nil : it.id; Haptics.tick() } label: {
            VStack(alignment: .leading, spacing: 4) {
                RemoteImage(url: store.api.imageURL(it.image), api: store.api, placeholder: "fork.knife")
                    .frame(width: 132, height: 74)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.sm))
                Text(it.title).font(.caption.weight(.semibold)).foregroundStyle(Theme.ink).lineLimit(2)
                    .multilineTextAlignment(.leading)
                if let d = it.detail { Text(d).font(.caption2).foregroundStyle(Theme.ink3).lineLimit(1) }
            }
            .frame(width: 132, alignment: .topLeading)
            .padding(5)
            .background(on ? Theme.primarySoft : Color.clear, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
            .overlay(RoundedRectangle(cornerRadius: Theme.Radius.base).stroke(on ? Theme.primary : Color.clear, lineWidth: 2))
        }
        .buttonStyle(.plain)
        .draggable(RecipeDrag(id: it.id).payload) {
            HStack(spacing: 6) {
                Image(systemName: "fork.knife")
                Text(it.title).lineLimit(1)
            }
            .padding(8).background(Theme.surface, in: Capsule())
        }
        .contextMenu {
            ForEach(model.days.filter { $0 >= today }, id: \.self) { d in
                Button { Task { await plan(it.id, title: it.title, on: d) } } label: { Text(LF("Plan for %@", CookDay.label(d))) }
            }
        }
        .accessibilityAddTraits(on ? .isSelected : [])
        .accessibilityHint(L("Then tap a day to plan it there."))
    }

    // MARK: actions

    private func plan(_ recipeId: Int, title: String, on day: String) async {
        let api = store.api
        do {
            let newId = try await api.addPlanEntry(day: day, recipeId: recipeId, title: nil)
            Haptics.success()
            selected = nil
            store.touch("recipes")
            feedback.say(LF("%@ on %@", title, CookDay.label(day))) {
                if let newId { try? await api.deletePlan(newId) }
                await model.load(api)
            }
        } catch { feedback.fail(error) }
        await model.load(api)
    }

    private func move(_ id: Int, to day: String) async {
        guard let e = model.entry(id), e.day != day else { return }
        let prev = e.day, api = store.api
        model.setLocalDay(id, day)
        do {
            try await api.movePlan(id, day: day)
            Haptics.tick()
            feedback.say(LF("Moved to %@", CookDay.label(day))) {
                try? await api.movePlan(id, day: prev)
                await model.load(api)
            }
        } catch { feedback.fail(error) }
        await model.load(api)
    }

    private func remove(_ e: WeekEntry) async {
        let api = store.api
        do {
            try await api.deletePlan(e.id)
            feedback.say(LF("Removed “%@” from the plan", e.title)) {
                try? await api.planEntry(day: e.day, slot: e.slot ?? "abend", recipeId: e.recipeId, title: e.title, servings: e.servings, note: e.note)
                await model.load(api)
            }
        } catch { feedback.fail(error) }
        await model.load(api)
    }
}
