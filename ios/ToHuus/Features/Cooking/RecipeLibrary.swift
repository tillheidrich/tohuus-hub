import SwiftUI

/// Kochen › Rezepte as photo cards (web: Cook.tsx RecipesView "rgrid"): search by title or tag – or "mit: Hähnchen,
/// Paprika" by ingredients –, filters (favourites, Thermomix, quick, never cooked), sorting, and a long press for
/// the things you do with a recipe without opening it: plan it for a day, start cooking, favourite, missing to list.
struct RecipeLibrarySection: View {
    let store: ServerStore
    let model: CookModel
    let feedback: CookFeedback
    @Binding var search: String
    var searchFocused: FocusState<Bool>.Binding
    let open: (RecipeRef) -> Void
    let newRecipe: () -> Void
    let openTools: () -> Void
    @Environment(AppModel.self) private var app
    @State private var cards: [RecipeCard] = []
    @State private var loaded = false
    @AppStorage("cook.library.filter") private var filter = "all"
    @AppStorage("cook.library.sort") private var sort = "az"
    @State private var cookId: Int?

    private var terms: [String]? { CookModel.ingredientTerms(search) }

    struct Row: Identifiable {
        var card: RecipeCard
        var hit: IngredientSearchHit?
        var id: Int { card.id }
    }

    private var rows: [Row] {
        if terms != nil {
            let byId = Dictionary(cards.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
            return (model.hits ?? []).compactMap { h in byId[h.id].map { Row(card: $0, hit: h) } }
        }
        let q = search.trimmingCharacters(in: .whitespaces)
        var list = cards.filter { c in
            q.isEmpty || "\(c.title) \((c.tags ?? []).joined(separator: " "))".range(of: q, options: [.caseInsensitive, .diacriticInsensitive]) != nil
        }
        switch filter {
        case "fav": list = list.filter(\.isFavorite)
        case "tm": list = list.filter(\.isThermomix)
        case "quick": list = list.filter { ($0.timeMin ?? 999) <= 30 }
        case "new": list = list.filter { ($0.cookCount ?? 0) == 0 }
        default: break
        }
        switch sort {
        case "recent": list.sort { ($0.lastCooked ?? "") > ($1.lastCooked ?? "") }
        case "often": list.sort { ($0.cookCount ?? 0) > ($1.cookCount ?? 0) }
        default: break
        }
        return list.map { Row(card: $0, hit: nil) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s3) {
            searchBar
            if let terms {
                Text(LCF("Recipes with %@ – most matches first. Nothing needs to be in stock for this.", terms.joined(separator: ", ")))
                    .font(.caption).foregroundStyle(Theme.ink3)
            } else {
                filterBar
            }
            let list = rows
            if list.isEmpty && loaded {
                if cards.isEmpty {
                    EmptyStateView(systemImage: "book", title: L("No recipes yet."),
                                   message: L("Write one down, take over a link or a photo – or share a recipe link to ToHuus from Safari."),
                                   actionTitle: L("New recipe"), action: newRecipe)
                } else if terms == nil || model.hits != nil {
                    Text(search.isEmpty ? L("No recipe fits this filter.") : LCF("No recipe matches “%@”.", search))
                        .font(.subheadline).foregroundStyle(Theme.ink3)
                }
            }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 158, maximum: 260), spacing: Theme.Space.s3)], spacing: Theme.Space.s3) {
                ForEach(list) { row in card(row.card, hit: row.hit) }
            }
            toolsRow.padding(.top, Theme.Space.s2)
        }
        .task(id: store.revision("recipes")) {
            if let c = try? await store.api.recipeCards() { cards = c }
            loaded = true
        }
        .task(id: terms?.joined(separator: ",") ?? "") { await model.search(terms, api: store.api) }
        .fullScreenCover(item: Binding(get: { cookId.map { RecipeRef(id: $0) } }, set: { cookId = $0?.id })) { ref in
            CookModeView(store: store, recipeId: ref.id) { open(ref) }
        }
    }

    private var searchBar: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").foregroundStyle(Theme.ink3)
            TextField(LC("Search recipes – or “with: chicken, peppers”"), text: $search)
                .focused(searchFocused)
                .autocorrectionDisabled()
            if !search.isEmpty {
                Button { search = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.ink3) }
                    .accessibilityLabel(LC("Clear"))
            } else {
                Button(LC("Search by ingredients")) {
                    search = Locale.current.language.languageCode?.identifier == "de" ? "mit: " : "with: "
                    searchFocused.wrappedValue = true
                }
                .font(.caption.weight(.semibold))
            }
        }
        .padding(10)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
        .overlay(RoundedRectangle(cornerRadius: Theme.Radius.base).stroke(Theme.line, lineWidth: 1))
    }

    private var filterBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                CookChip(title: cards.count == 1 ? L("1 recipe") : LF("%d recipes", cards.count), on: filter == "all") { filter = "all" }
                CookChip(title: L("Favourites"), systemImage: "heart", on: filter == "fav") { filter = filter == "fav" ? "all" : "fav" }
                if cards.contains(where: \.isThermomix) {
                    CookChip(title: "Thermomix", on: filter == "tm") { filter = filter == "tm" ? "all" : "tm" }
                }
                CookChip(title: L("≤ 30 min"), systemImage: "clock", on: filter == "quick") { filter = filter == "quick" ? "all" : "quick" }
                CookChip(title: L("Never cooked"), systemImage: "sparkles", on: filter == "new") { filter = filter == "new" ? "all" : "new" }
                Menu {
                    Picker(L("Sort"), selection: $sort) {
                        Text(L("A–Z")).tag("az")
                        Text(L("Recently cooked")).tag("recent")
                        Text(L("Cooked most often")).tag("often")
                    }
                } label: {
                    Label(L("Sort"), systemImage: "arrow.up.arrow.down")
                        .font(.subheadline)
                        .padding(.horizontal, 12).frame(minHeight: 36)
                        .background(Theme.surface, in: Capsule())
                        .overlay(Capsule().stroke(Theme.line, lineWidth: 1))
                        .padding(.vertical, 4)
                }
                .foregroundStyle(Theme.ink)
            }
        }
    }

    private func subline(_ c: RecipeCard, hit: IngredientSearchHit?) -> String {
        if let hit {
            return hit.missing.isEmpty ? LCF("with %@", hit.matched.joined(separator: ", "))
                : LCF("with %@ · without %@", hit.matched.joined(separator: ", "), hit.missing.joined(separator: ", "))
        }
        let n = c.cookCount ?? 0
        return [c.timeMin.map { LF("%d min", Int($0)) }, n > 0 ? LF("cooked %d×", n) : L("never cooked")].compactMap { $0 }.joined(separator: " · ")
    }

    private func card(_ c: RecipeCard, hit: IngredientSearchHit?) -> some View {
        Button { open(RecipeRef(id: c.id)) } label: {
            VStack(alignment: .leading, spacing: 0) {
                Color.clear
                    .aspectRatio(4 / 3, contentMode: .fit)
                    .overlay(RemoteImage(url: store.api.imageURL(c.imagePath), api: store.api, placeholder: "fork.knife"))
                    .clipped()
                    .overlay(alignment: .topLeading) {
                        if c.isThermomix {
                            Text("TM").font(.caption2.weight(.bold)).padding(.horizontal, 6).padding(.vertical, 2)
                                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 4)).padding(6)
                        }
                    }
                    .overlay(alignment: .topTrailing) {
                        if c.isFavorite {
                            Image(systemName: "heart.fill").foregroundStyle(Theme.clay)
                                .padding(6).background(.regularMaterial, in: Circle()).padding(6)
                        }
                    }
                VStack(alignment: .leading, spacing: 3) {
                    HStack(alignment: .firstTextBaseline, spacing: 4) {
                        Text(c.title).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                            .lineLimit(2).multilineTextAlignment(.leading)
                        SampleTag(on: app.sampleMarks.recipes.contains(c.id))
                    }
                    Text(subline(c, hit: hit)).font(.caption).foregroundStyle(Theme.ink3).lineLimit(2)
                }
                .padding(10)
                .frame(maxWidth: .infinity, minHeight: 64, alignment: .topLeading)
            }
            .background(Theme.surface)
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.lg))
            .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).stroke(Theme.line, lineWidth: 1))
            .contentShape(RoundedRectangle(cornerRadius: Theme.Radius.lg))
        }
        .buttonStyle(.plain)
        .hoverEffect(.lift)
        .draggable(RecipeDrag(id: c.id).payload) {
            Text(c.title).padding(8).background(Theme.surface, in: Capsule())
        }
        .contextMenu { menu(c) } preview: {
            VStack(alignment: .leading, spacing: 6) {
                RemoteImage(url: store.api.imageURL(c.imagePath), api: store.api, placeholder: "fork.knife")
                    .frame(width: 300, height: 200)
                Text(c.title).font(.headline).padding(.horizontal, 12)
                if let d = c.description, !d.isEmpty { Text(d).font(.caption).foregroundStyle(Theme.ink2).lineLimit(3).padding(.horizontal, 12) }
                Text(subline(c, hit: nil)).font(.caption).foregroundStyle(Theme.ink3).padding([.horizontal, .bottom], 12)
            }
            .frame(width: 300)
            .background(Theme.surface)
        }
        .accessibilityLabel(c.title + ", " + subline(c, hit: hit) + (c.isFavorite ? ", " + L("Favourite") : ""))
    }

    @ViewBuilder
    private func menu(_ c: RecipeCard) -> some View {
        Button { cookId = c.id } label: { Label(L("Start cooking"), systemImage: "flame") }
        Menu {
            ForEach((0..<7).map { CookDay.add(CookDay.today(), $0) }, id: \.self) { d in
                Button(CookDay.label(d)) { Task { await plan(c, d) } }
            }
        } label: { Label(L("Plan for …"), systemImage: "calendar.badge.plus") }
        Button { Task { await toggleFavorite(c) } } label: {
            Label(c.isFavorite ? L("Remove from favourites") : L("Add to favourites"), systemImage: c.isFavorite ? "heart.slash" : "heart")
        }
        Button { Task { await missing(c) } } label: { Label(L("Missing ingredients to the list"), systemImage: "cart.badge.plus") }
    }

    private var toolsRow: some View {
        VStack(spacing: 0) {
            toolButton(L("New recipe"), L("Write it down: ingredients, steps, photo."), "square.and.pencil", run: newRecipe)
            Divider()
            toolButton(L("Recipe tools"), L("Photos, AI import, export, recipe package."), "wrench.and.screwdriver", run: openTools)
        }
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
        .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).stroke(Theme.line, lineWidth: 1))
    }

    private func toolButton(_ title: String, _ detail: String, _ icon: String, run: @escaping () -> Void) -> some View {
        Button(action: run) {
            HStack(spacing: Theme.Space.s3) {
                Image(systemName: icon).foregroundStyle(Theme.primaryText).frame(width: 28)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.body.weight(.semibold)).foregroundStyle(Theme.ink)
                    Text(detail).font(.caption).foregroundStyle(Theme.ink3)
                }
                Spacer()
                Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(Theme.ink3)
            }
            .padding(Theme.Space.s3)
            .frame(minHeight: 56)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: actions

    private func plan(_ c: RecipeCard, _ day: String) async {
        let api = store.api
        do {
            let id = try await api.addPlanEntry(day: day, recipeId: c.id, title: nil)
            Haptics.success()
            store.touch("recipes")
            feedback.say(LF("%@ on %@", c.title, CookDay.label(day))) {
                if let id { try? await api.deletePlan(id) }
                store.touch("recipes")
            }
        } catch { feedback.fail(error) }
    }

    private func toggleFavorite(_ c: RecipeCard) async {
        let on = !c.isFavorite
        if let i = cards.firstIndex(where: { $0.id == c.id }) { cards[i].favorite = .bool(on) }
        Haptics.tick()
        do { try await store.api.setFavorite(c.id, on); store.touch("recipes") } catch {
            if let i = cards.firstIndex(where: { $0.id == c.id }) { cards[i].favorite = .bool(!on) }
            feedback.fail(error)
        }
    }

    private func missing(_ c: RecipeCard) async {
        do {
            let n = try await store.api.recipeToList(c.id, servings: nil)
            store.touch("shopping")
            await store.refreshList()
            feedback.say(n == 0 ? LC("Everything is already here or on the list") : n == 1 ? LC("Added 1 ingredient to the shopping list") : LCF("Added %d ingredients to the shopping list", n))
        } catch { feedback.fail(error) }
    }
}
