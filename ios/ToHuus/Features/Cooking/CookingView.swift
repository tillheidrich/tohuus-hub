import Observation
import SwiftUI

@MainActor
@Observable
final class CookModel {
    private(set) var ideas: [CookIdea] = []
    private(set) var recipes: [Recipe] = []
    private(set) var plan: PlanResponse?
    private(set) var loading = false
    var error: String?

    func load(_ api: APIClient) async {
        loading = true
        defer { loading = false }
        do {
            async let i = api.cookIdeas()
            async let r = api.recipes()
            async let p = api.plan(from: ServerDate.day())
            ideas = try await i
            recipes = (try? await r) ?? recipes
            plan = (try? await p) ?? plan
            error = nil
        } catch {
            let e = APIError.from(error)
            if !(e.isOffline && !ideas.isEmpty) { self.error = e.localizedDescription }
        }
    }

    func removePlan(_ e: PlanEntry, api: APIClient) async {
        try? await api.deletePlan(e.id)
        await load(api)
    }

    /// Drag & drop (or the "Move to" menu) in the week plan: PATCH /api/plan/:id { day }.
    func movePlan(_ id: Int, to day: String, api: APIClient) async {
        guard let entry = plan?.entries.first(where: { $0.id == id }), entry.day != day else { return }
        if let i = plan?.entries.firstIndex(where: { $0.id == id }) { plan?.entries[i].day = day }
        do {
            try await api.movePlan(id, day: day)
            Haptics.tick()
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
        await load(api)
    }
}

struct CookingView: View {
    let store: ServerStore
    @Environment(AppModel.self) private var app
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var selectedRecipe: Int?
    @FocusState private var searchFocused: Bool
    @State private var dropTarget: String?
    @State private var model = CookModel()
    @State private var tab = 0
    @State private var search = ""
    @State private var toast: String?

    var body: some View {
        NavigationStack {
            HStack(spacing: 0) {
                column
                    .frame(maxWidth: sizeClass == .regular ? 440 : .infinity)
                if sizeClass == .regular {
                    Divider()
                    Group {
                        if let selectedRecipe {
                            RecipeDetailView(recipeId: selectedRecipe, store: store).id(selectedRecipe)
                        } else {
                            EmptyStateView(systemImage: "fork.knife", title: L("Choose a recipe on the left."),
                                           message: L("Or open the kitchen mode: big week plan, recipe step by step, list to tick."))
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .canvasBackground()
                }
            }
            .navigationTitle(L("Cooking"))
            .navigationDestination(for: Int.self) { id in RecipeDetailView(recipeId: id, store: store) }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        app.showKitchen = true
                    } label: {
                        Label(L("Kitchen mode"), systemImage: "frying.pan")
                    }
                    .hoverEffect(.highlight)
                }
            }
            .onChange(of: app.searchRequest) { _, _ in
                tab = 2
                searchFocused = true
            }
        }
    }

    /// Opens a recipe: next to the list on wide screens, pushed on the iPhone.
    @ViewBuilder
    private func recipeLink<Label: View>(_ id: Int, @ViewBuilder label: () -> Label) -> some View {
        if sizeClass == .regular {
            Button { selectedRecipe = id } label: { label() }
                .buttonStyle(.plain)
                .hoverEffect(.highlight)
        } else {
            NavigationLink(value: id) { label() }
                .buttonStyle(.plain)
        }
    }

    private var column: some View {
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Space.s4) {
                    Picker("", selection: $tab) {
                        Text(L("What shall we cook?")).tag(0)
                        Text(L("Week")).tag(1)
                        Text(L("Recipes")).tag(2)
                    }
                    .pickerStyle(.segmented)
                    if let error = model.error { ErrorBanner(message: error) { Task { await model.load(store.api) } } }
                    switch tab {
                    case 0: ideas
                    case 1: week
                    default: recipeList
                    }
                }
                .padding(Theme.Space.s4)
                .padding(.bottom, 80)
            }
            .canvasBackground()
            .refreshable { await model.load(store.api) }
            .task(id: store.revision("recipes") + store.revision("stock")) { await model.load(store.api) }
            .overlay(alignment: .bottom) {
                if let toast {
                    Text(toast).font(.subheadline).padding(12).background(Theme.ink, in: Capsule()).foregroundStyle(Theme.canvas)
                        .padding(.bottom, 90)
                        .task { try? await Task.sleep(nanoseconds: 2_500_000_000); self.toast = nil }
                }
            }
    }

    @ViewBuilder private var ideas: some View {
        if model.ideas.isEmpty && !model.loading {
            EmptyStateView(systemImage: "fork.knife", title: L("No ideas yet."),
                           message: L("Add a few recipes (by hand or as a link) and ToHuus shows what you can cook from what's at home."))
        }
        let now = model.ideas.filter { $0.missing.isEmpty }
        let almost = model.ideas.filter { !$0.missing.isEmpty && $0.missing.count <= 2 }
        if !now.isEmpty {
            Text(L("You can cook this today")).font(.headline)
            ForEach(now) { idea in ideaCard(idea) }
        }
        if !almost.isEmpty {
            Text(L("Only one or two things missing")).font(.headline).padding(.top, Theme.Space.s2)
            ForEach(almost) { idea in ideaCard(idea) }
        }
    }

    private func ideaCard(_ idea: CookIdea) -> some View {
        recipeLink(idea.recipeId) {
            HStack(spacing: Theme.Space.s3) {
                RemoteImage(url: store.api.imageURL(idea.image), api: store.api, placeholder: "fork.knife")
                    .frame(width: 76, height: 76)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.base))
                VStack(alignment: .leading, spacing: 4) {
                    Text(idea.title).font(.headline).foregroundStyle(Theme.ink).multilineTextAlignment(.leading)
                    if let t = idea.timeMin { Label(LF("%d min", Int(t)), systemImage: "timer").font(.caption).foregroundStyle(Theme.ink3) }
                    if !idea.missing.isEmpty {
                        Text(LF("Missing: %@", idea.missing.map(\.name).joined(separator: ", "))).font(.caption).foregroundStyle(Theme.low)
                    }
                    if !idea.reasons.isEmpty {
                        // the server's neutral reasons ("alles da · verbraucht Feta")
                        Text(idea.reasons.prefix(2).joined(separator: " · ")).font(.caption)
                            .foregroundStyle(idea.missing.isEmpty ? Theme.primaryText : Theme.ink2)
                    } else if idea.missing.isEmpty {
                        Text(L("Everything is at home.")).font(.caption).foregroundStyle(Theme.primaryText)
                    }
                    if !idea.probablyHave.isEmpty {
                        Text(LF("Probably at home: %@", idea.probablyHave.joined(separator: ", "))).font(.caption).foregroundStyle(Theme.ink3)
                    }
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").foregroundStyle(Theme.ink3)
            }
            .padding(Theme.Space.s3)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
            .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).stroke(selectedRecipe == idea.recipeId && sizeClass == .regular ? Theme.primary : Theme.line, lineWidth: 1))
            .contentShape(Rectangle())
        }
    }

    @ViewBuilder private var week: some View {
        if let plan = model.plan {
            ForEach(plan.days, id: \.self) { day in
                let entries = plan.entries.filter { $0.day == day }
                VStack(alignment: .leading, spacing: 6) {
                    Text(ServerDate.shortDay(day) ?? day).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink2)
                    if entries.isEmpty {
                        Text(L("Nothing planned")).font(.subheadline).foregroundStyle(Theme.ink3)
                    }
                    ForEach(entries) { e in
                        HStack {
                            if let rid = e.recipeId {
                                recipeLink(rid) { Text(e.title).foregroundStyle(Theme.ink) }
                            } else {
                                Text(e.title)
                            }
                            Spacer()
                            if e.isCooked { Image(systemName: "checkmark").foregroundStyle(Theme.primaryText) }
                            Menu {
                                Menu {
                                    ForEach(plan.days.filter { $0 != e.day }, id: \.self) { d in
                                        Button(ServerDate.shortDay(d) ?? d) { Task { await model.movePlan(e.id, to: d, api: store.api) } }
                                    }
                                } label: { Label(L("Move to"), systemImage: "arrow.left.arrow.right") }
                                Button(role: .destructive) {
                                    Task { await model.removePlan(e, api: store.api) }
                                } label: { Label(L("Remove"), systemImage: "trash") }
                            } label: {
                                Image(systemName: "ellipsis").foregroundStyle(Theme.ink3).frame(width: 44, height: 44)
                            }
                            .accessibilityLabel(LF("Options for %@", e.title))
                        }
                        .font(Theme.rowFont)
                        .draggable(PlanDrag(id: e.id).payload) {
                            Text(e.title).padding(8).background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.sm))
                        }
                    }
                }
                .padding(Theme.Space.s3)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(dropTarget == day ? Theme.primarySoft : Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
                .dropDestination(for: String.self) { items, _ in
                    guard let id = items.compactMap(PlanDrag.init(payload:)).first?.id else { return false }
                    Task { await model.movePlan(id, to: day, api: store.api) }
                    return true
                } isTargeted: { on in dropTarget = on ? day : (dropTarget == day ? nil : dropTarget) }
            }
            Button {
                Task {
                    do {
                        try await store.api.planToList(from: ServerDate.day())
                        store.touch("shopping")
                        await store.refreshList()
                        toast = L("Everything missing for the week is on the list.")
                    } catch { model.error = APIError.from(error).localizedDescription }
                }
            } label: {
                Label(L("Missing for the week → list"), systemImage: "cart.badge.plus")
            }
            .buttonStyle(SecondaryButtonStyle())
            Text(L("Drag a meal to another day, or use the … menu. Plan a meal from the recipe page or ask the assistant."))
                .font(.footnote).foregroundStyle(Theme.ink3)
        } else if model.loading {
            ProgressView().frame(maxWidth: .infinity)
        }
    }

    @ViewBuilder private var recipeList: some View {
        TextField(L("Search recipes"), text: $search)
            .focused($searchFocused)
            .padding(10)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
            .overlay(RoundedRectangle(cornerRadius: Theme.Radius.base).stroke(Theme.line, lineWidth: 1))
        let list = model.recipes.filter { search.isEmpty || $0.title.range(of: search, options: [.caseInsensitive, .diacriticInsensitive]) != nil }
        if list.isEmpty && !model.loading {
            EmptyStateView(systemImage: "book", title: L("No recipes yet."), message: L("Share a recipe link to ToHuus from Safari to add it."))
        }
        LazyVStack(alignment: .leading, spacing: 0) {
            ForEach(list) { r in
                recipeLink(r.id) {
                    HStack(spacing: Theme.Space.s3) {
                        RemoteImage(url: store.api.imageURL(r.imagePath), api: store.api, placeholder: "fork.knife")
                            .frame(width: 44, height: 44)
                            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.sm))
                        Text(r.title).foregroundStyle(Theme.ink).multilineTextAlignment(.leading)
                        Spacer()
                        if r.favorite?.bool == true { Image(systemName: "heart.fill").foregroundStyle(Theme.clay) }
                    }
                    .padding(.vertical, 8)
                    .contentShape(Rectangle())
                }
                Divider()
            }
        }
    }
}

/// Drag payload for a week-plan entry ("tohuus-plan:<id>"), so other text dropped on a day is ignored.
struct PlanDrag {
    let id: Int
    var payload: String { "tohuus-plan:\(id)" }
    init(id: Int) { self.id = id }
    init?(payload: String) {
        guard payload.hasPrefix("tohuus-plan:"), let n = Int(payload.dropFirst(12)) else { return nil }
        id = n
    }
}
