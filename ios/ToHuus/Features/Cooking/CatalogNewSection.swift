import SwiftUI

/// "Neu diese Woche" – ToHuus-Rezepte from the cloud catalogue at the top of "Was kochen wir?". One tap saves a copy
/// into the household's recipes (source "ToHuus"); a saved one opens instead. Cloud only.
struct CatalogNewSection: View {
    let store: ServerStore
    let openRecipe: (RecipeRef) -> Void
    @State private var list: CatalogList?
    @State private var busy: Int?
    @State private var error: String?

    private var cards: [CatalogCard] {
        guard let list else { return [] }
        return list.newThisWeek.isEmpty ? Array(list.recent.prefix(6)) : list.newThisWeek
    }

    var body: some View {
        Group {
            if !cards.isEmpty {
                VStack(alignment: .leading, spacing: Theme.Space.s2) {
                    Text(list?.newThisWeek.isEmpty == false ? L("New this week") : L("New from ToHuus"))
                        .font(.headline).foregroundStyle(Theme.ink)
                        .accessibilityAddTraits(.isHeader)
                    Text(L("ToHuus recipes – simple everyday dishes")).font(.footnote).foregroundStyle(Theme.ink2)
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(alignment: .top, spacing: Theme.Space.s3) {
                            ForEach(cards) { card($0) }
                        }
                    }
                    if let error { Text(error).font(.footnote).foregroundStyle(Theme.empty) }
                }
            }
        }
        .task { list = try? await store.api.catalogRecipes() }
    }

    private func card(_ c: CatalogCard) -> some View {
        let saved = list?.saved[String(c.id)]
        return VStack(alignment: .leading, spacing: 6) {
            ZStack(alignment: .bottomLeading) {
                if c.image != nil {
                    RemoteImage(url: store.api.imageURL(c.image), api: store.api, placeholder: "fork.knife")
                        .scaledToFill()
                } else {
                    // the dish name on the brand tint until a real photo exists
                    ZStack(alignment: .topLeading) {
                        Theme.primary.opacity(0.12)
                        VStack(alignment: .leading) {
                            Image(systemName: "fork.knife").foregroundStyle(Theme.primary)
                            Spacer()
                            Text(c.title).font(.subheadline.weight(.bold)).foregroundStyle(Theme.ink)
                                .lineLimit(3).minimumScaleFactor(0.8)
                        }
                        .padding(10)
                    }
                }
                if c.imageKind == "ai" {
                    Text(L("AI image")).font(.caption2.weight(.bold)).padding(.horizontal, 6).padding(.vertical, 2)
                        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 4)).padding(6)
                }
            }
            .frame(width: 160, height: 120)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .accessibilityHidden(true)
            Text(c.title).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                .lineLimit(2).fixedSize(horizontal: false, vertical: true)
            if let m = c.timeMin { Text(LF("%d min", m)).font(.caption).foregroundStyle(Theme.ink2) }
            Text(c.aiAssisted == true ? L("Written with AI, checked by us") : L("Checked by us"))
                .font(.caption2).foregroundStyle(Theme.ink3).lineLimit(2).fixedSize(horizontal: false, vertical: true)
            if let saved {
                Button { openRecipe(RecipeRef(id: saved)) } label: { Label(L("In your recipes"), systemImage: "checkmark") }
                    .font(.footnote.weight(.semibold)).frame(minHeight: 44)
            } else {
                Button { Task { await save(c) } } label: { Label(L("Save"), systemImage: "bookmark") }
                    .font(.footnote.weight(.semibold)).frame(minHeight: 44)
                    .disabled(busy == c.id)
                    .accessibilityLabel(LF("Save %@ to your recipes", c.title))
            }
        }
        .frame(width: 160, alignment: .leading)
    }

    private func save(_ c: CatalogCard) async {
        busy = c.id
        defer { busy = nil }
        do {
            let r = try await store.api.saveCatalogRecipe(c.id)
            list?.saved[String(c.id)] = r.id
            error = nil
            openRecipe(RecipeRef(id: r.id))
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }
}
