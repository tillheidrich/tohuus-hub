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
}

struct CookingView: View {
    let store: ServerStore
    @State private var model = CookModel()
    @State private var tab = 0
    @State private var search = ""
    @State private var toast: String?

    var body: some View {
        NavigationStack {
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
            .navigationTitle(L("Cooking"))
            .navigationDestination(for: Int.self) { id in RecipeDetailView(recipeId: id, store: store) }
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
        NavigationLink(value: idea.recipeId) {
            HStack(spacing: Theme.Space.s3) {
                RemoteImage(url: store.api.imageURL(idea.image), api: store.api, placeholder: "fork.knife")
                    .frame(width: 76, height: 76)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.base))
                VStack(alignment: .leading, spacing: 4) {
                    Text(idea.title).font(.headline).foregroundStyle(Theme.ink).multilineTextAlignment(.leading)
                    if let t = idea.timeMin { Label(LF("%d min", Int(t)), systemImage: "timer").font(.caption).foregroundStyle(Theme.ink3) }
                    if idea.missing.isEmpty {
                        Text(L("Everything is at home.")).font(.caption).foregroundStyle(Theme.primaryText)
                    } else {
                        Text(LF("Missing: %@", idea.missing.map(\.name).joined(separator: ", "))).font(.caption).foregroundStyle(Theme.low)
                    }
                    if let r = idea.reasons.first { Text(r).font(.caption).foregroundStyle(Theme.ink2) }
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").foregroundStyle(Theme.ink3)
            }
            .padding(Theme.Space.s3)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
            .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).stroke(Theme.line, lineWidth: 1))
        }
        .buttonStyle(.plain)
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
                                NavigationLink(value: rid) { Text(e.title).foregroundStyle(Theme.ink) }
                            } else {
                                Text(e.title)
                            }
                            Spacer()
                            if e.isCooked { Image(systemName: "checkmark").foregroundStyle(Theme.primaryText) }
                            Menu {
                                Button(role: .destructive) {
                                    Task { await model.removePlan(e, api: store.api) }
                                } label: { Label(L("Remove"), systemImage: "trash") }
                            } label: {
                                Image(systemName: "ellipsis").foregroundStyle(Theme.ink3).frame(width: 30, height: 30)
                            }
                        }
                        .font(Theme.rowFont)
                    }
                }
                .padding(Theme.Space.s3)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
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
            Text(L("Plan a meal from the recipe page or ask the assistant.")).font(.footnote).foregroundStyle(Theme.ink3)
        } else if model.loading {
            ProgressView().frame(maxWidth: .infinity)
        }
    }

    @ViewBuilder private var recipeList: some View {
        TextField(L("Search recipes"), text: $search)
            .padding(10)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
            .overlay(RoundedRectangle(cornerRadius: Theme.Radius.base).stroke(Theme.line, lineWidth: 1))
        let list = model.recipes.filter { search.isEmpty || $0.title.range(of: search, options: [.caseInsensitive, .diacriticInsensitive]) != nil }
        if list.isEmpty && !model.loading {
            EmptyStateView(systemImage: "book", title: L("No recipes yet."), message: L("Share a recipe link to ToHuus from Safari to add it."))
        }
        LazyVStack(alignment: .leading, spacing: 0) {
            ForEach(list) { r in
                NavigationLink(value: r.id) {
                    HStack(spacing: Theme.Space.s3) {
                        RemoteImage(url: store.api.imageURL(r.imagePath), api: store.api, placeholder: "fork.knife")
                            .frame(width: 44, height: 44)
                            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.sm))
                        Text(r.title).foregroundStyle(Theme.ink).multilineTextAlignment(.leading)
                        Spacer()
                        if r.favorite?.bool == true { Image(systemName: "heart.fill").foregroundStyle(Theme.clay) }
                    }
                    .padding(.vertical, 8)
                }
                .buttonStyle(.plain)
                Divider()
            }
        }
    }
}
