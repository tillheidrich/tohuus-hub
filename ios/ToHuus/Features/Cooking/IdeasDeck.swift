import SwiftUI

/// "Daraus könnt ihr heute kochen" (web: Cook.tsx CookIdeas, GET /api/cook/ideas): what is (almost) at home, with the
/// missing things to the list in one tap – each row keeps its recipe line as note.
struct CookIdeasStrip: View {
    let store: ServerStore
    let feedback: CookFeedback
    let openRecipe: (RecipeRef) -> Void
    @State private var ideas: [CookIdea] = []
    @State private var added: Set<Int> = []

    var body: some View {
        Group {
            if !ideas.isEmpty {
                VStack(alignment: .leading, spacing: Theme.Space.s2) {
                    CookHeading(title: L("You can cook this today"))
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(alignment: .top, spacing: Theme.Space.s3) {
                            ForEach(ideas.prefix(8)) { i in tile(i) }
                        }
                    }
                }
            }
        }
        .task(id: store.revision("recipes") + store.revision("stock")) { ideas = (try? await store.api.cookIdeas()) ?? ideas }
    }

    private func tile(_ i: CookIdea) -> some View {
        let miss = i.missing.map(\.name)
        return VStack(alignment: .leading, spacing: 4) {
            Button { openRecipe(RecipeRef(id: i.recipeId)) } label: {
                RemoteImage(url: store.api.imageURL(i.image), api: store.api, placeholder: "fork.knife")
                    .frame(width: 168, height: 104)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.base))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(i.title)
            Text(i.title).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink).lineLimit(2)
            Text(miss.isEmpty ? L("Everything is at home") : LF("Missing: %@", miss.joined(separator: ", ")))
                .font(.caption).foregroundStyle(miss.isEmpty ? Theme.primaryText : Theme.ink3).lineLimit(2)
            if !i.probablyHave.isEmpty {
                Text(LF("Probably at home: %@", i.probablyHave.joined(separator: ", "))).font(.caption2).foregroundStyle(Theme.ink3).lineLimit(2)
            }
            if !miss.isEmpty {
                Button { Task { await addMissing(i) } } label: {
                    Label(added.contains(i.recipeId) ? L("On the list") : L("Put on the list"), systemImage: added.contains(i.recipeId) ? "checkmark" : "cart.badge.plus")
                        .font(.caption.weight(.semibold))
                        .frame(minHeight: 36)
                }
                .disabled(added.contains(i.recipeId))
            }
        }
        .frame(width: 168, alignment: .leading)
    }

    private func addMissing(_ i: CookIdea) async {
        let names = i.missing.map(\.name)
        do {
            _ = try await store.api.recipeLinesToList(i.recipeId, only: names)
            added.insert(i.recipeId)
            Haptics.success()
            store.touch("shopping")
            await store.refreshList()
            feedback.say(names.count == 1 ? LF("%@ is on the shopping list", names[0]) : LF("%d things are on the shopping list", names.count))
        } catch { feedback.fail(error) }
    }
}

/// "Ideen durchblättern" (web: SwipeDeck over /api/recipes/suggest): one card at a time, sorted by what's in stock,
/// expiry dates, favourites and how long it's been. Swipe right (or "Lecker") opens it, left shows the next one.
struct SuggestDeckSection: View {
    let store: ServerStore
    let openRecipe: (RecipeRef) -> Void
    var addRecipe: () -> Void = {}
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var deck: [RecipeSuggestion] = []
    @State private var loaded = false
    @State private var idx = 0
    @State private var tm = "all"
    @State private var drag: CGSize = .zero

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s3) {
            CookHeading(title: L("Browse ideas"))
            HStack {
                if deck.contains(where: { $0.recipe.isThermomix }) || tm != "all" {
                    Picker("", selection: $tm) {
                        Text(L("All")).tag("all")
                        Text("Thermomix").tag("tm")
                        Text(L("Without")).tag("no")
                    }
                    .pickerStyle(.segmented)
                    .frame(maxWidth: 280)
                }
                Spacer()
                if deck.count > 1 {
                    Button { next() } label: { Label(L("next idea"), systemImage: "arrow.triangle.2.circlepath").font(.subheadline.weight(.semibold)) }
                }
            }
            if !loaded {
                RoundedRectangle(cornerRadius: 26).fill(Theme.surface2).frame(height: 380).frame(maxWidth: 420)
                    .frame(maxWidth: .infinity)
            } else if deck.isEmpty {
                EmptyStateView(systemImage: "fork.knife", title: L("No suggestions yet"),
                               message: L("Add a few favorite recipes – by link, photo (e.g. a HelloFresh card) or via Claude/ChatGPT."),
                               actionTitle: L("Add a recipe"), action: addRecipe)
            } else {
                ZStack {
                    if deck.count > 1 { card(deck[(idx + 1) % deck.count], top: false) }
                    card(deck[idx % deck.count], top: true)
                        .offset(x: drag.width, y: drag.height * 0.15)
                        .rotationEffect(.degrees(reduceMotion ? 0 : Double(drag.width / 22)))
                        .gesture(
                            DragGesture()
                                .onChanged { drag = $0.translation }
                                .onEnded { v in
                                    if v.translation.width > 110 { yes() } else if v.translation.width < -110 { next() } else {
                                        withAnimation(reduceMotion ? nil : .spring()) { drag = .zero }
                                    }
                                }
                        )
                }
                .frame(maxWidth: 420)
                .frame(maxWidth: .infinity)
                HStack(spacing: Theme.Space.s4) {
                    Button { next() } label: { Label(L("Not today"), systemImage: "xmark").frame(maxWidth: .infinity) }
                        .buttonStyle(SecondaryButtonStyle())
                    Button { yes() } label: { Label(L("Yum"), systemImage: "heart").frame(maxWidth: .infinity) }
                        .buttonStyle(PrimaryButtonStyle())
                }
                .frame(maxWidth: 420)
                .frame(maxWidth: .infinity)
                Text(L("Swipe or tap. Sorted by what's in stock, expiry dates, favorites and how long it's been."))
                    .font(.caption).foregroundStyle(Theme.ink3)
            }
        }
        .task(id: "\(tm)-\(store.revision("recipes"))-\(store.revision("stock"))") {
            deck = (try? await store.api.recipeSuggestions(thermomix: tm == "tm" ? true : tm == "no" ? false : nil)) ?? deck
            idx = 0
            loaded = true
        }
    }

    private func card(_ s: RecipeSuggestion, top: Bool) -> some View {
        let badges = [s.recipe.isThermomix ? "Thermomix" : nil, s.recipe.timeMin.map { LF("%d min", Int($0)) }].compactMap { $0 }
        return VStack(alignment: .leading, spacing: 0) {
            ZStack(alignment: .topLeading) {
                Color.clear.frame(height: 240)
                    .overlay(RemoteImage(url: store.api.imageURL(s.recipe.imagePath), api: store.api, placeholder: "fork.knife"))
                    .clipped()
                if top && abs(drag.width) > 30 {
                    Text(drag.width > 0 ? L("YUM") : L("NOT TODAY"))
                        .font(.title2.weight(.heavy))
                        .foregroundStyle(drag.width > 0 ? Theme.primary : Theme.clay)
                        .padding(.horizontal, 12).padding(.vertical, 6)
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(drag.width > 0 ? Theme.primary : Theme.clay, lineWidth: 3))
                        .rotationEffect(.degrees(drag.width > 0 ? -12 : 12))
                        .padding(18)
                        .frame(maxWidth: .infinity, alignment: drag.width > 0 ? .leading : .trailing)
                }
            }
            VStack(alignment: .leading, spacing: 6) {
                Text(s.recipe.title).font(.title3.weight(.semibold)).foregroundStyle(Theme.ink).lineLimit(2)
                if let h = s.have, let n = s.need {
                    Text(LF("%d/%d ingredients on hand", h, n)).font(.caption.weight(.semibold))
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(Theme.primarySoft, in: Capsule()).foregroundStyle(Theme.primaryText)
                }
                if !badges.isEmpty { Text(badges.joined(separator: " · ")).font(.caption).foregroundStyle(Theme.ink2) }
                if let r = s.reasons, !r.isEmpty { Text(r.joined(separator: " · ")).font(.caption).foregroundStyle(Theme.ink3).lineLimit(3) }
            }
            .padding(Theme.Space.s4)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Theme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 26))
        .overlay(RoundedRectangle(cornerRadius: 26).stroke(Theme.line, lineWidth: 1))
        .scaleEffect(top ? 1 : 0.96)
        .offset(y: top ? 0 : 10)
        .accessibilityElement(children: .combine)
        .accessibilityHidden(!top)
        .accessibilityAction(named: L("Yum")) { yes() }
        .accessibilityAction(named: L("Not today")) { next() }
    }

    private func next() {
        guard !deck.isEmpty else { return }
        if reduceMotion { drag = .zero; idx += 1; return }
        withAnimation(.easeOut(duration: 0.18)) { drag = CGSize(width: -600, height: 0) }
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(180))
            drag = .zero
            idx += 1
        }
    }

    private func yes() {
        guard !deck.isEmpty else { return }
        let r = deck[idx % deck.count].recipe
        withAnimation(reduceMotion ? nil : .spring()) { drag = .zero }
        Haptics.tick()
        openRecipe(RecipeRef(id: r.id))
    }
}
