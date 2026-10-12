import SwiftUI

struct RecipeDetailView: View {
    let recipeId: Int
    let store: ServerStore
    @State private var recipe: Recipe?
    @State private var matches: [IngredientMatch] = []
    @State private var error: String?
    @State private var toast: String?
    @State private var showPlan = false
    @State private var planDay = Date()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.s4) {
                if let r = recipe {
                    if r.imagePath != nil {
                        RemoteImage(url: store.api.imageURL(r.imagePath), api: store.api, placeholder: "fork.knife")
                            .frame(height: 220)
                            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.lg))
                    }
                    Text(r.title).font(Theme.title())
                    HStack(spacing: Theme.Space.s4) {
                        if let t = r.timeMin { Label(LF("%d min", Int(t)), systemImage: "timer") }
                        if let s = r.servings { Label(LF("%d servings", Int(s)), systemImage: "person.2") }
                    }
                    .font(.subheadline).foregroundStyle(Theme.ink2)
                    if let d = r.description, !d.isEmpty { Text(d).foregroundStyle(Theme.ink2) }
                    ingredients(r)
                    buttons(r)
                    if !r.steps.isEmpty { steps(r) }
                    if let src = r.sourceUrl, let url = URL(string: src) {
                        Link(L("Open original recipe"), destination: url).font(.footnote)
                    }
                } else if let error {
                    ErrorBanner(message: error) { Task { await load() } }
                } else {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 60)
                }
            }
            .padding(Theme.Space.s4)
            .padding(.bottom, 80)
        }
        .canvasBackground()
        .navigationBarTitleDisplayMode(.inline)
        .task(id: store.revision("recipes") + store.revision("stock")) { await load() }
        .sheet(isPresented: $showPlan) { planSheet }
        .overlay(alignment: .bottom) {
            if let toast {
                Text(toast).font(.subheadline).padding(12).background(Theme.ink, in: Capsule()).foregroundStyle(Theme.canvas)
                    .padding(.bottom, 24)
                    .task { try? await Task.sleep(nanoseconds: 2_500_000_000); self.toast = nil }
            }
        }
    }

    private var missingCount: Int { matches.filter { !$0.atHome }.count }

    private func load() async {
        do {
            async let r = store.api.recipe(recipeId)
            async let m = store.api.recipeMatch(recipeId)
            recipe = try await r
            matches = (try? await m) ?? []
            error = nil
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }

    private func ingredients(_ r: Recipe) -> some View {
        Card(title: L("Ingredients"), systemImage: "basket") {
            if matches.isEmpty {
                ForEach(r.ingredients, id: \.stableId) { i in Text(i.text).font(.subheadline) }
            } else {
                ForEach(matches) { m in
                    HStack(alignment: .firstTextBaseline, spacing: Theme.Space.s2) {
                        Image(systemName: m.atHome ? "checkmark.circle.fill" : "circle.dashed")
                            .foregroundStyle(m.atHome ? Theme.primary : Theme.low)
                        Text(m.text).font(.subheadline)
                        Spacer()
                        if !m.atHome { Text(L("missing")).font(.caption).foregroundStyle(Theme.low) }
                    }
                }
            }
        }
    }

    private func buttons(_ r: Recipe) -> some View {
        VStack(spacing: Theme.Space.s3) {
            if missingCount > 0 {
                Button {
                    Task {
                        do {
                            let res = try await store.api.missingToList(r.id)
                            store.touch("shopping")
                            await store.refreshList()
                            Haptics.success()
                            toast = LF("%d things are on the list now.", res.added ?? 0)
                        } catch { toast = APIError.from(error).localizedDescription }
                    }
                } label: {
                    Label(LF("Missing → list (%d)", missingCount), systemImage: "cart.badge.plus")
                }
                .buttonStyle(PrimaryButtonStyle())
            }
            HStack(spacing: Theme.Space.s3) {
                Button {
                    showPlan = true
                } label: {
                    Label(L("Plan"), systemImage: "calendar.badge.plus")
                }
                .buttonStyle(SecondaryButtonStyle())
                Button {
                    Task {
                        do {
                            try await store.api.cooked(r.id)
                            Haptics.success()
                            toast = L("Enjoy your meal!")
                            store.touch("recipes", "stock")
                        } catch { toast = APIError.from(error).localizedDescription }
                    }
                } label: {
                    Label(L("Cooked"), systemImage: "checkmark")
                }
                .buttonStyle(SecondaryButtonStyle())
            }
        }
    }

    private func steps(_ r: Recipe) -> some View {
        Card(title: L("Steps"), systemImage: "list.number") {
            ForEach(Array(r.steps.enumerated()), id: \.offset) { idx, s in
                HStack(alignment: .top, spacing: Theme.Space.s3) {
                    Text("\(idx + 1)").font(.headline).foregroundStyle(Theme.primaryText).frame(width: 22)
                    Text(s.text).font(.body)
                }
            }
        }
    }

    private var planSheet: some View {
        NavigationStack {
            Form {
                DatePicker(L("Day"), selection: $planDay, in: Date()..., displayedComponents: .date)
                    .datePickerStyle(.graphical)
            }
            .navigationTitle(L("Plan meal"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { showPlan = false } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(L("Plan")) {
                        Task {
                            do {
                                try await store.api.addPlan(day: ServerDate.day(planDay), recipeId: recipeId, title: nil)
                                store.touch("recipes")
                                toast = L("Planned.")
                            } catch { toast = APIError.from(error).localizedDescription }
                            showPlan = false
                        }
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}
