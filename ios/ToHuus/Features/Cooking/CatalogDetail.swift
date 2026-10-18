import SwiftUI

/// One ToHuus recipe from the cloud catalogue (web: CloudRecipes.tsx CatalogSheet): picture, where it comes from,
/// allergens, ingredients and steps – then save a copy to the household's recipes. A Plus recipe without Plus shows
/// the card and the way to Plus.
struct CatalogDetailSheet: View {
    let store: ServerStore
    let card: CatalogCard
    var savedId: Int?
    let onSaved: (Int) -> Void
    let openRecipe: (RecipeRef) -> Void
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var recipe: CatalogRecipeFull?
    @State private var error: String?
    @State private var busy = false

    private static var allergenLabels: [String: String] {
        [
            "gluten": L("Gluten"),
            "crustaceans": L("Crustaceans"),
            "eggs": L("Eggs"),
            "fish": L("Fish"),
            "peanuts": L("Peanuts"),
            "soy": L("Soy"),
            "milk": L("Milk"),
            "nuts": L("Nuts"),
            "celery": L("Celery"),
            "mustard": L("Mustard"),
            "sesame": L("Sesame"),
            "sulphites": L("Sulphites"),
            "lupin": L("Lupin"),
            "molluscs": L("Molluscs"),
        ]
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Space.s4) {
                    picture
                    if let d = recipe?.description ?? card.description, !d.isEmpty { Text(d).foregroundStyle(Theme.ink2) }
                    Text(origin).font(.caption).foregroundStyle(Theme.ink3)
                    if card.locked == true {
                        Text(L("This recipe is part of Plus. With Plus you get new seasonal recipes with pictures, the week plan from what is at home and more."))
                            .font(.subheadline).foregroundStyle(Theme.ink2)
                    } else if let r = recipe {
                        let meta = [r.timeMin.map { LF("%d min", $0) }, r.servings.map { $0 == 1 ? L("1 serving") : LF("%d servings", $0) }].compactMap { $0 }
                        if !meta.isEmpty { Text(meta.joined(separator: " · ")).font(.subheadline.weight(.semibold)) }
                        if let a = r.allergens, !a.isEmpty {
                            Text(L("Contains") + ": " + a.map { Self.allergenLabels[$0] ?? $0 }.joined(separator: ", ")).font(.subheadline)
                        }
                        Card(title: L("Ingredients"), systemImage: "basket") {
                            ForEach(Array(r.ingredients.enumerated()), id: \.offset) { _, i in
                                Text("• " + i.text).font(.subheadline)
                            }
                        }
                        Card(title: L("Steps"), systemImage: "list.number") {
                            ForEach(Array(r.steps.enumerated()), id: \.offset) { n, s in
                                HStack(alignment: .top, spacing: Theme.Space.s3) {
                                    Text("\(n + 1)").font(.headline).foregroundStyle(Theme.primaryText).frame(width: 22)
                                    Text(s.text).font(.body)
                                }
                            }
                        }
                    } else if let error {
                        ErrorBanner(message: error) { Task { await load() } }
                    } else {
                        ProgressView().frame(maxWidth: .infinity).padding(.vertical, 30)
                    }
                }
                .padding(Theme.Space.s4)
                .padding(.bottom, 90)
            }
            .canvasBackground()
            .safeAreaInset(edge: .bottom) { footer }
            .navigationTitle(card.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(L("Close")) { dismiss() } } }
            .task { if card.locked != true { await load() } }
        }
    }

    private var origin: String {
        var parts = [card.aiAssisted == true ? (card.reviewState == "cooked" ? L("Written with AI, cooked and checked by us") : L("Written with AI, checked by us"))
                     : (card.reviewState == "cooked" ? L("Cooked and checked by us") : L("Checked by us"))]
        if let r = recipe, let lic = r.license, lic != "ToHuus" { parts.append(lic + (r.sourceAuthors.map { " (\($0))" } ?? "")) }
        if let c = card.imageCredit { parts.append(LF("Photo: %@", c)) }
        return parts.joined(separator: " · ")
    }

    private var picture: some View {
        ZStack(alignment: .bottomLeading) {
            if card.image != nil {
                Color.clear.frame(height: 220)
                    .overlay(RemoteImage(url: store.api.imageURL(card.image), api: store.api, placeholder: "fork.knife"))
                    .clipped()
            } else {
                ZStack(alignment: .bottomLeading) {
                    Theme.primary.opacity(0.12)
                    Text(card.title).font(Theme.title(26)).foregroundStyle(Theme.ink).padding(Theme.Space.s4)
                }
                .frame(height: 180)
            }
            if card.imageKind == "ai" {
                Text(L("AI image")).font(.caption2.weight(.bold)).padding(.horizontal, 6).padding(.vertical, 2)
                    .background(Theme.surface, in: RoundedRectangle(cornerRadius: 4)).padding(8)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.lg))
        .accessibilityHidden(true)
    }

    private var footer: some View {
        Group {
            if card.locked == true {
                Button { dismiss(); app.openPaywall("plus_recipe") } label: { Text(L("See Plus")) }
                    .buttonStyle(PrimaryButtonStyle())
            } else if let saved = savedId ?? recipe?.savedId {
                Button { dismiss(); openRecipe(RecipeRef(id: saved)) } label: { Label(L("Open in your recipes"), systemImage: "book") }
                    .buttonStyle(PrimaryButtonStyle())
            } else {
                Button { Task { await save() } } label: { Label(busy ? L("Saving…") : L("Save to our recipes"), systemImage: "bookmark") }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(busy || recipe == nil)
            }
        }
        .padding(Theme.Space.s4)
        .background(.regularMaterial)
    }

    private func load() async {
        do { recipe = try await store.api.catalogRecipe(card.id); error = nil } catch {
            if case .quota = APIError.from(error) { dismiss(); app.openPaywall("plus_recipe"); return }
            self.error = APIError.from(error).localizedDescription
        }
    }

    private func save() async {
        busy = true
        defer { busy = false }
        do {
            let r = try await store.api.saveCatalogRecipe(card.id)
            store.touch("recipes")
            Haptics.success()
            onSaved(r.id)
            dismiss()
            openRecipe(RecipeRef(id: r.id))
        } catch { self.error = APIError.from(error).localizedDescription }
    }
}

/// All published ToHuus recipes (the latest 24) as cards.
struct CatalogAllView: View {
    let store: ServerStore
    let openRecipe: (RecipeRef) -> Void
    @State private var list: CatalogList?
    @State private var open: CatalogCard?

    var body: some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 158), spacing: Theme.Space.s3)], spacing: Theme.Space.s3) {
                ForEach(list?.recent ?? []) { c in
                    Button { open = c } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Color.clear.aspectRatio(4 / 3, contentMode: .fit)
                                .overlay(RemoteImage(url: store.api.imageURL(c.image), api: store.api, placeholder: "fork.knife"))
                                .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.base))
                                .overlay(alignment: .topTrailing) {
                                    if c.locked == true { Image(systemName: "lock.fill").padding(6).background(.regularMaterial, in: Circle()).padding(6) }
                                    else if list?.saved[String(c.id)] != nil { Image(systemName: "checkmark").padding(6).background(.regularMaterial, in: Circle()).padding(6) }
                                }
                            Text(c.title).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink).lineLimit(2).multilineTextAlignment(.leading)
                            if let m = c.timeMin { Text(LF("%d min", m)).font(.caption).foregroundStyle(Theme.ink3) }
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(Theme.Space.s4)
        }
        .canvasBackground()
        .navigationTitle(L("ToHuus recipes"))
        .navigationBarTitleDisplayMode(.inline)
        .task { list = try? await store.api.catalogRecipes() }
        .sheet(item: $open) { c in
            CatalogDetailSheet(store: store, card: c, savedId: list?.saved[String(c.id)], onSaved: { id in list?.saved[String(c.id)] = id }, openRecipe: openRecipe)
        }
    }
}
