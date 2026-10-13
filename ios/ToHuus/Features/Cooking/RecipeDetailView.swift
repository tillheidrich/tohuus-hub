import PhotosUI
import SwiftUI

/// Recipe page (web: pages/Recipe.tsx, RecipeServings.tsx, RecipeVariant.tsx, people/Ratings.tsx):
/// servings that scale the amounts, house version, favourite, ratings per person, "cooked it" with what was used
/// up and leftovers, edit and delete.
struct RecipeDetailView: View {
    let recipeId: Int
    let store: ServerStore
    var planEntryId: Int?
    var onDeleted: (() -> Void)?
    @Environment(\.dismiss) private var dismiss
    @State private var recipe: RecipeFull?
    @State private var matches: [RecipeMatchLine] = []
    @State private var variant: RecipeVariantView?
    @State private var ratings: RecipeRatings?
    @State private var planEntry: PlanEntryDetail?
    @State private var servings: Int?
    @State private var showOriginal = false
    @State private var error: String?
    @State private var feedback = CookFeedback()
    @State private var showPlan = false
    @State private var planDay = Date()
    @State private var showCooked = false
    @State private var showEdit = false
    @State private var showVariant = false
    @State private var rateWho: RecipeRatings.Person?
    @State private var confirmOriginal = false
    @State private var photoItem: PhotosPickerItem?
    @State private var photoBusy = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.s4) {
                if let r = recipe {
                    header(r)
                    actions(r)
                    servingsRow(r)
                    ingredients(r)
                    ratingsRow(r)
                    if !r.steps.isEmpty { steps(r) } else if let n = r.notes, !n.isEmpty { Text(n).font(.subheadline).foregroundStyle(Theme.ink2) }
                    footer(r)
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
        .toolbar {
            if let r = recipe {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { Task { await toggleFavorite(r) } } label: {
                        Image(systemName: r.isFavorite ? "heart.fill" : "heart").foregroundStyle(r.isFavorite ? Theme.clay : Theme.ink2)
                    }
                    .accessibilityLabel(LC("Favorite"))
                    .accessibilityAddTraits(r.isFavorite ? .isSelected : [])
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showEdit = true } label: { Label(LC("Edit"), systemImage: "pencil") }
                }
            }
        }
        .task(id: store.revision("recipes") + store.revision("stock")) { await load() }
        .sheet(isPresented: $showPlan) { planSheet }
        .sheet(isPresented: $showCooked) {
            if let r = recipe {
                CookedSheet(store: store, recipe: r, matches: matches, factor: factor(r), planEntryId: planEntry?.id, ratings: ratings, feedback: feedback) {
                    Task { await load() }
                }
            }
        }
        .sheet(isPresented: $showEdit) {
            if let r = recipe {
                RecipeEditSheet(store: store, recipe: r) {
                    Task { await load() }
                } onDeleted: {
                    store.touch("recipes")
                    if let onDeleted { onDeleted() } else { dismiss() }
                }
            }
        }
        .sheet(isPresented: $showVariant) {
            if let r = recipe, let v = variant { VariantSheet(store: store, recipe: r, view: v, feedback: feedback) { Task { await load() } } }
        }
        .sheet(item: $rateWho) { p in rateSheet(p) }
        .onChange(of: photoItem) { _, item in
            guard let item else { return }
            Task { await uploadPhoto(item) }
        }
        .confirmationDialog(LC("Back to the original recipe? Your changes for this recipe are removed."), isPresented: $confirmOriginal, titleVisibility: .visible) {
            Button(LC("Back to original"), role: .destructive) {
                Task {
                    do {
                        try await store.api.deleteVariant(recipeId)
                        feedback.say(LCF("Back to the original – %@ is cooked as written again.", recipe?.title ?? ""))
                        store.touch("recipes")
                    } catch { feedback.fail(error) }
                    await load()
                }
            }
        }
        .cookToast($feedback.toast) { Task { await feedback.undo?() } }
    }

    // MARK: photo

    /// own photo for the recipe (web: Recipe.tsx → POST /api/recipes/:id/image), long side max 1600 px
    private func uploadPhoto(_ item: PhotosPickerItem) async {
        photoBusy = true
        defer { photoBusy = false; photoItem = nil }
        guard let d = try? await item.loadTransferable(type: Data.self), let img = UIImage(data: d) else { return }
        let scale = min(1, 1600 / max(img.size.width, img.size.height))
        let size = CGSize(width: img.size.width * scale, height: img.size.height * scale)
        let jpeg = UIGraphicsImageRenderer(size: size).image { _ in img.draw(in: CGRect(origin: .zero, size: size)) }.jpegData(compressionQuality: 0.82)
        guard let jpeg else { return }
        do {
            try await store.api.uploadRecipePhoto(recipeId, jpeg: jpeg)
            store.touch("recipes")
            Haptics.success()
            await load()
        } catch {
            feedback.fail(error)
        }
    }

    // MARK: load

    private func load() async {
        do {
            async let r = store.api.recipeFull(recipeId)
            async let m = store.api.recipeMatchLines(recipeId)
            async let v = store.api.recipeVariant(recipeId)
            async let p = store.api.recipeRatings(recipeId)
            recipe = try await r
            matches = (try? await m) ?? []
            variant = try? await v
            ratings = try? await p
            error = nil
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
        if let planEntryId, planEntry == nil, let e = try? await store.api.planEntryDetail(planEntryId), e.recipeId == recipeId {
            planEntry = e
            servings = e.servings
        }
    }

    /// household base: our servings (house version), else the recipe's
    private func base(_ r: RecipeFull) -> Int? { variant?.variant?.servings ?? r.baseServings }
    private func factor(_ r: RecipeFull) -> Double {
        guard let s = servings, let b = base(r), b > 0 else { return 1 }
        return Double(s) / Double(b)
    }
    private var missing: [RecipeMatchLine] { matches.filter(\.isMissing) }

    // MARK: sections

    private func header(_ r: RecipeFull) -> some View {
        VStack(alignment: .leading, spacing: Theme.Space.s3) {
            if r.imagePath != nil {
                RemoteImage(url: store.api.imageURL(r.imagePath), api: store.api, placeholder: "fork.knife")
                    .frame(height: 220).frame(maxWidth: .infinity)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.lg))
                    .overlay(alignment: .bottomTrailing) {
                        PhotosPicker(selection: $photoItem, matching: .images) {
                            Image(systemName: photoBusy ? "hourglass" : "camera")
                                .font(.body.weight(.semibold)).foregroundStyle(Theme.ink)
                                .frame(width: 44, height: 44)
                                .background(.regularMaterial, in: Circle())
                        }
                        .accessibilityLabel(LC("Change photo"))
                        .padding(10)
                    }
            } else {
                PhotosPicker(selection: $photoItem, matching: .images) {
                    Label(photoBusy ? LC("Saving …") : LC("Add photo"), systemImage: "camera")
                        .font(.subheadline.weight(.semibold))
                        .frame(maxWidth: .infinity, minHeight: 56)
                        .background(Theme.surface2, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
                        .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).strokeBorder(Theme.line, style: StrokeStyle(lineWidth: 1, dash: [5, 4])))
                }
                .buttonStyle(.plain)
                .foregroundStyle(Theme.primaryText)
            }
            if let s = sourceLabel(r.sourceType) { Text(s).font(.caption.weight(.semibold)).foregroundStyle(Theme.ink3) }
            Text(r.title).font(Theme.title())
            if let d = r.description, !d.isEmpty { Text(d).foregroundStyle(Theme.ink2) }
            FlowLayout {
                if r.thermomix == true { StatusPill(text: "Thermomix", status: nil) }
                if let t = variant?.variant?.timeMin ?? r.timeMin.map({ Int($0) }) { StatusPill(text: LCF("%d min", t), status: nil) }
                ForEach(r.tags ?? [], id: \.self) { tag in StatusPill(text: tag, status: nil) }
            }
        }
    }

    private func sourceLabel(_ s: String?) -> String? {
        switch s {
        case "hellofresh": return "HelloFresh"
        case "cookidoo": return "Cookidoo"
        case "monsieur-cuisine": return "Monsieur Cuisine"
        case "cookit": return "Home Connect"
        case "kenwood": return "Kenwood World"
        case "tefal": return "Tefal"
        case "moulinex": return "Moulinex"
        case "krups": return "Krups"
        case "magimix": return "Magimix"
        case "kitchenaid": return "KitchenAid"
        case "cecotec": return "Cecotec Mambo"
        case "nutriu": return "NutriU"
        case "url": return LC("From the web")
        case "photo": return LC("From a photo")
        case "own": return LC("House recipe")
        case "family": return LC("Family recipe")
        default: return nil
        }
    }

    private func actions(_ r: RecipeFull) -> some View {
        VStack(spacing: Theme.Space.s3) {
            Button { showCooked = true } label: { Label(LC("Cooked it!"), systemImage: "checkmark") }
                .buttonStyle(PrimaryButtonStyle())
            if !missing.isEmpty {
                Button { Task { await missingToList(r) } } label: {
                    Label(missing.count == 1 ? LC("Add 1 missing ingredient to the list") : LCF("Add %d missing ingredients to the list", missing.count), systemImage: "cart.badge.plus")
                }
                .buttonStyle(SecondaryButtonStyle())
            }
            Button { showPlan = true } label: { Label(L("Plan"), systemImage: "calendar.badge.plus") }
                .buttonStyle(SecondaryButtonStyle())
        }
    }

    @ViewBuilder
    private func servingsRow(_ r: RecipeFull) -> some View {
        if let b = base(r) {
            let cur = servings ?? b
            let changed = servings != nil && servings != b
            VStack(alignment: .leading, spacing: 6) {
                ServingsStepper(value: cur,
                                label: cur == 1 ? LC("1 serving") : LCF("%d servings", cur),
                                detail: changed ? LCF("Amounts scaled from %d", b) : LC("As written for your household"),
                                reset: changed ? { servings = nil } : nil) { n in servings = n == b ? nil : n }
                if let e = planEntry {
                    HStack(spacing: 4) {
                        Image(systemName: "calendar")
                        Text(e.servings.map { LCF("Planned for %d on %@", $0, CookDay.weekdayLong(e.day)) } ?? LCF("From the plan on %@", CookDay.weekdayLong(e.day)))
                        if e.servings != servings {
                            Button(LC("use for the plan")) {
                                Task {
                                    do {
                                        try await store.api.setEntryServings(e.id, servings == b ? nil : servings)
                                        planEntry?.servings = servings == b ? nil : servings
                                        store.touch("recipes", "shopping")
                                        feedback.say(LCF("Saved for the plan on %@", CookDay.weekdayLong(e.day)))
                                    } catch { feedback.fail(error) }
                                }
                            }
                            .font(.caption.weight(.semibold))
                        }
                    }
                    .font(.caption).foregroundStyle(Theme.ink3)
                }
            }
        } else {
            Label(LC("No servings set – add them in “Edit” to scale the amounts."), systemImage: "person.2")
                .font(.caption).foregroundStyle(Theme.ink3)
        }
    }

    private func ingredients(_ r: RecipeFull) -> some View {
        let f = factor(r)
        let sc: (String) -> String = { f == 1 ? $0 : AmountScale.scale($0, f) }
        let differs = variant?.differs ?? false
        let byText = Dictionary(matches.map { ($0.text, $0) }, uniquingKeysWith: { a, _ in a })
        return Card(title: L("Ingredients"), systemImage: "basket") {
            if differs {
                Picker("", selection: $showOriginal) {
                    Text(LC("Our way")).tag(false)
                    Text(LC("Original")).tag(true)
                }
                .pickerStyle(.segmented)
            }
            if differs && !showOriginal, let v = variant?.variant, (v.note ?? "").isEmpty == false || v.servings != nil || v.timeMin != nil {
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "note.text").foregroundStyle(Theme.primaryText)
                    VStack(alignment: .leading, spacing: 2) {
                        if let n = v.note, !n.isEmpty { Text(n).font(.subheadline) }
                        let parts = [v.servings.map { $0 == 1 ? LC("1 serving") : LCF("%d servings", $0) }, v.timeMin.map { LCF("%d min", $0) }].compactMap { $0 }
                        if !parts.isEmpty { Text(parts.joined(separator: " · ")).font(.caption).foregroundStyle(Theme.ink3) }
                    }
                }
                .padding(8).frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.primarySoft, in: RoundedRectangle(cornerRadius: Theme.Radius.sm))
            }
            if differs && showOriginal {
                ForEach(Array(r.ingredients.enumerated()), id: \.offset) { _, i in
                    Text(sc(i.text)).font(.subheadline)
                }
            } else if let lines = variant?.ingredients, !lines.isEmpty {
                ForEach(Array(lines.enumerated()), id: \.offset) { _, i in
                    ingredientLine(i, match: byText[i.text], sc: sc, recipeId: r.id)
                }
            } else if !matches.isEmpty {
                ForEach(matches) { m in
                    ingredientLine(.init(id: m.ingredientId, text: m.text, original: m.original, change: m.change, via: nil, ruleId: nil, pantry: m.pantry, optional: nil), match: m, sc: sc, recipeId: r.id)
                }
            } else {
                ForEach(Array(r.ingredients.enumerated()), id: \.offset) { _, i in Text(sc(i.text)).font(.subheadline) }
            }
            if r.ingredients.isEmpty { Text(LC("No ingredients yet.")).font(.subheadline).foregroundStyle(Theme.ink3) }
            if !r.ingredients.isEmpty {
                HStack(spacing: Theme.Space.s3) {
                    Button { showVariant = true } label: {
                        Label(differs ? LC("Edit our way") : LC("We cook it differently …"), systemImage: "arrow.left.arrow.right")
                    }
                    .disabled(variant == nil)
                    if variant?.variant != nil {
                        Button(LC("Back to original")) { confirmOriginal = true }
                    }
                }
                .font(.subheadline.weight(.semibold))
                .padding(.top, 4)
            }
        }
    }

    private func ingredientLine(_ i: RecipeVariantView.Line, match: RecipeMatchLine?, sc: (String) -> String, recipeId: Int) -> some View {
        let change = i.change ?? "none"
        let have = match?.atHome ?? false
        let kind = change == "remove" ? "off" : i.pantry == true ? "pantry" : have ? "have" : "miss"
        return HStack(alignment: .firstTextBaseline, spacing: Theme.Space.s2) {
            Image(systemName: kind == "have" ? "checkmark.circle.fill" : kind == "miss" ? "circle.dashed" : kind == "off" ? "nosign" : "minus.circle")
                .foregroundStyle(kind == "have" ? Theme.primary : kind == "miss" ? Theme.low : Theme.ink3)
            VStack(alignment: .leading, spacing: 2) {
                if change == "swap" {
                    HStack(spacing: 4) {
                        Text(i.original ?? "").strikethrough().foregroundStyle(Theme.ink3)
                        Image(systemName: "arrow.right").font(.caption2)
                        Text(sc(i.text)).fontWeight(.semibold)
                    }
                    .font(.subheadline)
                } else if change == "remove" {
                    Text(i.original ?? i.text).strikethrough().font(.subheadline).foregroundStyle(Theme.ink3)
                } else {
                    Text(sc(i.text)).font(.subheadline)
                }
                let sub = [
                    change == "swap" ? (i.via == "rule" ? LC("house rule") : i.via == "today" ? LC("just today") : LC("our way")) : nil,
                    change == "remove" ? (i.via == "today" ? LC("left out today") : LC("we leave it out")) : nil,
                    change == "add" ? (i.via == "today" ? LC("added today") : LC("we add this")) : nil,
                    kind == "miss" ? LC("missing") : nil,
                ].compactMap { $0 }
                if !sub.isEmpty || (i.via == "rule" && i.ruleId != nil) {
                    HStack(spacing: 4) {
                        Text(sub.joined(separator: " · ")).font(.caption).foregroundStyle(kind == "miss" ? Theme.low : Theme.ink3)
                        if i.via == "rule", let rule = i.ruleId {
                            Button(LC("not here")) {
                                Task {
                                    do {
                                        try await store.api.skipSwapRule(rule, recipeId: recipeId)
                                        feedback.say(LC("This recipe stays as written for that rule."))
                                        store.touch("recipes")
                                    } catch { feedback.fail(error) }
                                    await load()
                                }
                            }
                            .font(.caption.weight(.semibold))
                        }
                    }
                }
            }
            Spacer(minLength: 0)
        }
    }

    @ViewBuilder
    private func ratingsRow(_ r: RecipeFull) -> some View {
        if let rt = ratings, !rt.people.isEmpty {
            Card(title: LC("Who likes it?"), systemImage: "heart") {
                ForEach(rt.warnings ?? [], id: \.self) { w in Label(w, systemImage: "exclamationmark.triangle").font(.caption).foregroundStyle(Theme.low) }
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: Theme.Space.s3) {
                        ForEach(rt.people) { p in
                            let b = MealRating.bucket(p.value)
                            Button { rateWho = p } label: {
                                VStack(spacing: 4) {
                                    PersonDot(name: p.name, color: p.color, size: 42)
                                        .overlay(alignment: .bottomTrailing) {
                                            if let b {
                                                Image(systemName: b.icon + ".fill").font(.system(size: 10, weight: .bold))
                                                    .foregroundStyle(.white).frame(width: 20, height: 20)
                                                    .background(b == .loved ? Theme.clay : b == .okay ? Theme.mustard : Theme.ink2, in: Circle())
                                                    .offset(x: 4, y: 4)
                                            }
                                        }
                                    Text(p.name).font(.caption).foregroundStyle(Theme.ink2)
                                }
                                .frame(minWidth: 56)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("\(p.name): \(b?.label ?? LC("Not rated yet"))")
                        }
                    }
                    .padding(4)
                }
                if let n = rt.n, n > 0 { Text(n == 1 ? LC("1 rating") : LCF("%d ratings", n)).font(.caption).foregroundStyle(Theme.ink3) }
            }
        }
    }

    private func rateSheet(_ p: RecipeRatings.Person) -> some View {
        VStack(spacing: Theme.Space.s4) {
            Text(LCF("How does %@ like it?", p.name)).font(.headline).padding(.top, Theme.Space.s5)
            PersonDot(name: p.name, color: p.color, size: 64)
            RateButtons(value: p.value) { v in
                Task {
                    do {
                        try await store.api.ratePerson(recipeId, person: p.key, value: v)
                        Haptics.tick()
                        ratings = try? await store.api.recipeRatings(recipeId)
                    } catch { feedback.fail(error) }
                    rateWho = nil
                }
            }
            if let by = p.by, p.value != nil { Text(LCF("Rated by %@", by)).font(.caption).foregroundStyle(Theme.ink3) }
            Spacer()
        }
        .padding(Theme.Space.s4)
        .presentationDetents([.height(300)])
    }

    private func steps(_ r: RecipeFull) -> some View {
        Card(title: L("Steps"), systemImage: "list.number") {
            ForEach(Array(r.steps.enumerated()), id: \.offset) { idx, s in
                if let sec = s.section, !sec.isEmpty, idx == 0 || r.steps[idx - 1].section != sec {
                    Text(sec).font(.caption.weight(.bold)).foregroundStyle(Theme.ink3).padding(.top, 4)
                }
                HStack(alignment: .top, spacing: Theme.Space.s3) {
                    Text("\(idx + 1)").font(.headline).foregroundStyle(Theme.primaryText).frame(width: 22)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(s.text).font(.body)
                        let tm = [s.tm?["device"]?.string, s.tm?["time"]?.string, s.tm?["temp"]?.string, s.tm?["speed"]?.string.map { LCF("Speed %@", $0) }, s.tm?["mode"]?.string].compactMap { $0 }.filter { !$0.isEmpty }
                        if !tm.isEmpty { StatusPill(text: tm.joined(separator: " · "), status: nil) }
                    }
                }
            }
            if let n = r.notes, !n.isEmpty { Text(n).font(.footnote).foregroundStyle(Theme.ink3) }
        }
    }

    @ViewBuilder
    private func footer(_ r: RecipeFull) -> some View {
        if let last = r.log.first {
            let when = ServerDate.relative(last.cookedAt) ?? ""
            Text((last.actor.map { LCF("Last cooked %@ by %@", when, $0) } ?? LCF("Last cooked %@", when)) + " · " + LCF("%d× in total", r.log.count))
                .font(.footnote).foregroundStyle(Theme.ink3)
        }
        if let src = r.sourceUrl, let url = URL(string: src) {
            Link(L("Open original recipe"), destination: url).font(.footnote)
        }
    }

    // MARK: actions

    private func toggleFavorite(_ r: RecipeFull) async {
        let on = !r.isFavorite
        recipe?.favorite = on
        Haptics.tick()
        do { try await store.api.setFavorite(r.id, on); store.touch("recipes") } catch { recipe?.favorite = !on; feedback.fail(error) }
    }

    private func missingToList(_ r: RecipeFull) async {
        do {
            let n = try await store.api.recipeToList(r.id, servings: servings)
            store.touch("shopping")
            await store.refreshList()
            Haptics.success()
            feedback.say(n == 0 ? LC("Everything is already here or on the list") : n == 1 ? LC("Added 1 ingredient to the shopping list") : LCF("Added %d ingredients to the shopping list", n))
        } catch { feedback.fail(error) }
    }

    private var planSheet: some View {
        NavigationStack {
            Form {
                DatePicker(LC("Day"), selection: $planDay, in: Calendar.current.startOfDay(for: Date())..., displayedComponents: .date)
                    .datePickerStyle(.graphical)
                if let s = servings { Text(LCF("For %d people", s)).foregroundStyle(Theme.ink2) }
            }
            .themedList()
            .navigationTitle(L("Plan meal"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { showPlan = false } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(L("Plan")) {
                        Task {
                            do {
                                try await store.api.planEntry(day: ServerDate.day(planDay), recipeId: recipeId, title: nil, servings: servings)
                                store.touch("recipes")
                                feedback.say(L("Planned."))
                            } catch { feedback.fail(error) }
                            showPlan = false
                        }
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}

/// not for me / okay / loved it
struct RateButtons: View {
    let value: Int?
    var compact = false
    let onPick: (Int?) -> Void

    var body: some View {
        let b = MealRating.bucket(value)
        HStack(spacing: compact ? 4 : 8) {
            ForEach(MealRating.allCases) { r in
                let on = b == r
                Button { onPick(on ? nil : r.rawValue) } label: {
                    VStack(spacing: 2) {
                        Image(systemName: on ? r.icon + ".fill" : r.icon).font(compact ? .body : .title3)
                        if !compact { Text(r.label).font(.caption) }
                    }
                    .frame(minWidth: compact ? 40 : 84, minHeight: 44)
                    .foregroundStyle(on ? Theme.onPrimary : Theme.ink2)
                    .background(on ? (r == .loved ? Theme.clay : r == .okay ? Theme.primary : Theme.ink2) : Theme.surface2, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(r.label)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
    }
}
