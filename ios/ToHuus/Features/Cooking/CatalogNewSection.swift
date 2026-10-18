import SwiftUI

/// "Neu diese Woche" – ToHuus-Rezepte from the cloud catalogue at the top of "Was kochen wir?". One tap saves a copy
/// into the household's recipes (source "ToHuus"); a saved one opens instead. Cloud only.
struct CatalogNewSection: View {
    @Environment(AppModel.self) private var app
    let store: ServerStore
    let openRecipe: (RecipeRef) -> Void
    @State private var list: CatalogList?
    @State private var busy: Int?
    @State private var error: String?
    @State private var detail: CatalogCard?
    @State private var showAll = false

    private var cards: [CatalogCard] {
        guard let list else { return [] }
        return list.newThisWeek.isEmpty ? Array(list.recent.prefix(6)) : list.newThisWeek
    }

    var body: some View {
        LoadSlot {
            if !cards.isEmpty {
                VStack(alignment: .leading, spacing: Theme.Space.s2) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(list?.newThisWeek.isEmpty == false ? L("New this week") : L("New from ToHuus"))
                            .font(.headline).foregroundStyle(Theme.ink)
                            .accessibilityAddTraits(.isHeader)
                        Spacer()
                        if (list?.recent.count ?? 0) > cards.count {
                            Button(L("Show all")) { showAll = true }.font(.subheadline.weight(.semibold))
                        }
                    }
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
        .sheet(item: $detail) { c in
            CatalogDetailSheet(store: store, card: c, savedId: list?.saved[String(c.id)],
                               onSaved: { id in list?.saved[String(c.id)] = id }, openRecipe: openRecipe)
        }
        .sheet(isPresented: $showAll) {
            NavigationStack {
                CatalogAllView(store: store) { ref in
                    showAll = false
                    Task { @MainActor in try? await Task.sleep(for: .milliseconds(450)); openRecipe(ref) }
                }
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button(L("Close")) { showAll = false } } }
            }
        }
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
                if c.plus == true {
                    Text("Plus").font(.caption2.weight(.bold)).foregroundStyle(Theme.onPrimary)
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(Theme.primary, in: RoundedRectangle(cornerRadius: 4)).padding(6)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
                }
            }
            .frame(width: 160, height: 120)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .contentShape(Rectangle())
            .onTapGesture { detail = c }
            .accessibilityElement()
            .accessibilityLabel(LF("Show %@", c.title))
            .accessibilityAddTraits(.isButton)
            .accessibilityAction { detail = c }
            Text(c.title).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                .lineLimit(2).fixedSize(horizontal: false, vertical: true)
            if let m = c.timeMin { Text(LF("%d min", m)).font(.caption).foregroundStyle(Theme.ink2) }
            Text(c.aiAssisted == true ? L("Written with AI, checked by us") : L("Checked by us"))
                .font(.caption2).foregroundStyle(Theme.ink3).lineLimit(2).fixedSize(horizontal: false, vertical: true)
            if let credit = c.imageCredit {
                Text(LF("Photo: %@", credit)).font(.caption2).foregroundStyle(Theme.ink3).lineLimit(1)
            }
            if c.locked == true {
                // a Plus recipe without Plus: the plans instead of saving
                Button { app.openPaywall("plus_recipe") } label: { Label(L("Part of Plus"), systemImage: "lock") }
                    .font(.footnote.weight(.semibold)).frame(minHeight: 44)
                    .accessibilityLabel(LF("%@ is part of Plus", c.title))
            } else if let saved {
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
