import Observation
import SwiftUI

@MainActor
@Observable
final class CookModel {
    private(set) var ideas: [CookIdea] = []
    private(set) var recipes: [Recipe] = []
    private(set) var loading = false
    var error: String?
    /// "mit: Hähnchen, Paprika" → hits from /api/recipes/search
    private(set) var hits: [IngredientSearchHit]?
    private var hitsKey = ""

    func load(_ api: APIClient) async {
        loading = true
        defer { loading = false }
        do {
            async let i = api.cookIdeas()
            async let r = api.recipes()
            ideas = (try? await i) ?? ideas
            recipes = try await r
            error = nil
        } catch {
            let e = APIError.from(error)
            if !(e.isOffline && !recipes.isEmpty) { self.error = e.localizedDescription }
        }
    }

    func search(_ terms: [String]?, api: APIClient) async {
        guard let terms, !terms.isEmpty else { hits = nil; hitsKey = ""; return }
        let key = terms.joined(separator: ",")
        guard key != hitsKey else { return }
        hitsKey = key
        let r = try? await api.searchRecipes(with: key)
        if hitsKey == key { hits = r ?? [] }
    }

    /// "mit: Hähnchen, Paprika" / "with: chicken" (web: ingredientTerms)
    static func ingredientTerms(_ q: String) -> [String]? {
        guard let m = q.range(of: #"^\s*(mit|with)\s*:\s*"#, options: [.regularExpression, .caseInsensitive]) else { return nil }
        let rest = q[m.upperBound...]
        let parts = rest.replacingOccurrences(of: #"\s+(und|and)\s+"#, with: ",", options: [.regularExpression, .caseInsensitive])
            .split(whereSeparator: { $0 == "," || $0 == ";" }).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        return parts.isEmpty ? nil : Array(parts.prefix(6))
    }
}

struct CookingView: View {
    let store: ServerStore
    @Environment(AppModel.self) private var app
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var width: CGFloat = 0
    /// list + detail side by side only when there is room (not in a narrow Split View or iPad portrait with sidebar)
    private var wide: Bool { sizeClass == .regular && width >= 700 }
    @State private var selected: RecipeRef?
    @State private var path: [RecipeRef] = []
    @FocusState private var searchFocused: Bool
    @State private var showImport = false
    @State private var showSources = false
    @State private var showPackage = false
    @State private var showEditor = false
    @State private var showTools = false
    @State private var showFavourites = false
    @State private var sourcesQuery: String?
    @State private var model = CookModel()
    @State private var week = WeekModel()
    @State private var feedback = CookFeedback()
    @State private var tab = 0
    @State private var search = ""

    var body: some View {
        NavigationStack(path: $path) {
            HStack(spacing: 0) {
                column
                    .frame(width: wide ? 400 : nil)
                    .frame(maxWidth: wide ? 400 : .infinity)
                if wide {
                    Divider()
                    Group {
                        if let selected {
                            RecipeDetailView(recipeId: selected.id, store: store, planEntryId: selected.planEntryId, onDeleted: { self.selected = nil })
                                .id(selected)
                        } else {
                            EmptyStateView(systemImage: "fork.knife", title: L("Choose a recipe on the left."),
                                           message: L("Or open the kitchen mode: big week plan, recipe step by step, list to tick."))
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .canvasBackground()
                }
            }
            .onGeometryChangeCompat { w in width = w }
            .navigationTitle(L("Cooking"))
            .navigationDestination(for: RecipeRef.self) { ref in
                RecipeDetailView(recipeId: ref.id, store: store, planEntryId: ref.planEntryId)
            }
            .sheet(isPresented: $showImport) {
                RecipeImportSheet(store: store, openRecipe: openSaved, newBlank: {
                    Task { @MainActor in
                        try? await Task.sleep(for: .milliseconds(450))
                        showEditor = true
                    }
                })
            }
            .sheet(isPresented: $showEditor) { RecipeEditorView(store: store, recipe: nil, onSaved: openSaved) }
            .sheet(isPresented: $showTools) { RecipeToolsView(store: store, openRecipe: openSaved) }
            .sheet(isPresented: $showFavourites) {
                NavigationStack {
                    FavouritesView(store: store)
                        .navigationTitle(L("Favourites"))
                        .navigationBarTitleDisplayMode(.inline)
                        .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Done")) { showFavourites = false } } }
                }
            }
            .sheet(isPresented: $showPackage) {
                NavigationStack { RecipePackageView(store: store) { showPackage = false } }
            }
            .sheet(isPresented: $showSources) {
                NavigationStack {
                    OpenRecipeBrowser(store: store, onSaved: { id in showSources = false; openSaved(id) }, initialQuery: sourcesQuery)
                        .toolbar { ToolbarItem(placement: .cancellationAction) { Button(L("Close")) { showSources = false } } }
                }
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button { showEditor = true } label: { Label(L("New recipe"), systemImage: "square.and.pencil") }
                        Button { showImport = true } label: { Label(L("Take over: link, photo or text"), systemImage: "link") }
                        Button { sourcesQuery = nil; showSources = true } label: { Label(LC("Discover recipes"), systemImage: "globe.europe.africa") }
                        Divider()
                        Button { showTools = true } label: { Label(L("Recipe tools"), systemImage: "wrench.and.screwdriver") }
                    } label: { Label(L("Add recipe"), systemImage: "plus") }
                    .hoverEffect(.highlight)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showFavourites = true } label: { Label(L("Favourites"), systemImage: "heart") }
                        .hoverEffect(.highlight)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { app.showKitchen = true } label: { Label(L("Kitchen mode"), systemImage: "frying.pan") }
                        .hoverEffect(.highlight)
                }
            }
            .onChange(of: app.searchRequest) { _, _ in consumeSearch() }
            .onAppear {
                consumeSearch()
                applyDebug()
            }
        }
    }

    /// after a sheet saved a recipe: open it once the sheet is gone
    private func openSaved(_ id: Int) {
        tab = 2
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(450))
            open(RecipeRef(id: id))
        }
    }

    private func open(_ ref: RecipeRef) {
        if wide { selected = ref } else { path.append(ref) }
    }

    private func consumeSearch() {
        guard app.searchPending else { return }
        app.searchPending = false
        tab = 2
        searchFocused = true
    }

    /// Debug builds: -debugCook week|wte|recipes|recipe:<id>|votes|rotation (screenshots).
    private func applyDebug() {
        #if DEBUG
        guard let d = UserDefaults.standard.string(forKey: "debugCook") else { return }
        switch d {
        case "wte": tab = 0
        case "week": tab = 1
        case "recipes": tab = 2
        case "open": tab = 2; showSources = true
        case "import": tab = 2; showImport = true
        case "package": tab = 2; showPackage = true
        case "new": tab = 2; showEditor = true
        case "tools": tab = 2; showTools = true
        default:
            if d.hasPrefix("recipe:"), let id = Int(d.dropFirst(7)) { open(RecipeRef(id: id)) }
            if d.hasPrefix("with:") { tab = 2; search = "mit: " + d.dropFirst(5) }
            if d.hasPrefix("open:") { tab = 2; sourcesQuery = String(d.dropFirst(5)); showSources = true }
        }
        if let w = UserDefaults.standard.string(forKey: "debugCookWeek") { tab = 1; week.offset = Int(w) ?? 0 }
        #endif
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
                if let error = model.error, tab == 2 { ErrorBanner(message: error) { Task { await model.load(store.api) } } }
                switch tab {
                case 0:
                    CookIdeasStrip(store: store, feedback: feedback, openRecipe: open)
                    if app.isCloud { CatalogNewSection(store: store, openRecipe: open) }
                    WhatToEatSection(store: store, feedback: feedback, openRecipe: open, openImport: { showImport = true }, fallback: AnyView(ideas))
                    SuggestDeckSection(store: store, openRecipe: open, addRecipe: { showImport = true })
                        .padding(.top, Theme.Space.s4)
                case 1:
                    WeekPlanSection(store: store, model: week, feedback: feedback, openRecipe: open)
                default:
                    recipeList
                }
            }
            .padding(Theme.Space.s4)
            .padding(.bottom, 80)
        }
        .canvasBackground()
        .refreshable { await model.load(store.api); if tab == 1 { await week.load(store.api) } }
        .task(id: store.revision("recipes") + store.revision("stock")) { await model.load(store.api) }
        .cookToast($feedback.toast, bottom: 90) { Task { await feedback.undo?() } }
    }

    /// Older servers without /api/cook2: the plain idea list.
    @ViewBuilder private var ideas: some View {
        if model.ideas.isEmpty && !model.loading {
            EmptyStateView(systemImage: "fork.knife", title: L("No ideas yet."),
                           message: L("Add a few recipes (by hand or as a link) and ToHuus shows what you can cook from what's at home."))
        }
        ForEach(model.ideas) { idea in
            Button { open(RecipeRef(id: idea.recipeId)) } label: {
                HStack(spacing: Theme.Space.s3) {
                    RemoteImage(url: store.api.imageURL(idea.image), api: store.api, placeholder: "fork.knife")
                        .frame(width: 64, height: 64).clipShape(RoundedRectangle(cornerRadius: Theme.Radius.base))
                    VStack(alignment: .leading, spacing: 4) {
                        Text(idea.title).font(.headline).foregroundStyle(Theme.ink)
                        if !idea.missing.isEmpty {
                            Text(LF("Missing: %@", idea.missing.map(\.name).joined(separator: ", "))).font(.caption).foregroundStyle(Theme.low)
                        } else {
                            Text(L("Everything is at home.")).font(.caption).foregroundStyle(Theme.primaryText)
                        }
                    }
                    Spacer(minLength: 0)
                }
                .padding(Theme.Space.s3)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
            }
            .buttonStyle(.plain)
        }
    }

    @ViewBuilder private var recipeList: some View {
        RecipeLibrarySection(store: store, model: model, feedback: feedback, search: $search, searchFocused: $searchFocused,
                             open: open, newRecipe: { showEditor = true }, openTools: { showTools = true })
        discoverCard.padding(.top, Theme.Space.s4)
        SwapRulesSection(store: store, feedback: feedback).padding(.top, Theme.Space.s4)
    }
}

extension CookingView {
    /// „Rezepte entdecken“: open recipe database with photos (also in „Rezept hinzufügen“).
    var discoverCard: some View {
        Button { sourcesQuery = nil; showSources = true } label: {
            HStack(spacing: Theme.Space.s3) {
                Image(systemName: "globe.europe.africa").font(.title2).foregroundStyle(Theme.primaryText)
                    .frame(width: 44, height: 44).background(Theme.primarySoft, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
                VStack(alignment: .leading, spacing: 2) {
                    Text(LC("Discover recipes")).font(.headline).foregroundStyle(Theme.ink)
                    Text(LC("Browse an open recipe database with photos and take one over with a tap."))
                        .font(.caption).foregroundStyle(Theme.ink2).multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(Theme.ink3)
            }
            .padding(Theme.Space.s3)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
            .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).stroke(Theme.line, lineWidth: 1))
        }
        .buttonStyle(.plain)
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
