import SwiftUI

// Sheets of the recipe page: "Guten Appetit!" (cooked), "So machen wir das" (house version). Editing: RecipeEditorView.

// MARK: - cooked

struct CookedSheet: View {
    let store: ServerStore
    let recipe: RecipeFull
    let matches: [RecipeMatchLine]
    let factor: Double
    let planEntryId: Int?
    let ratings: RecipeRatings?
    let feedback: CookFeedback
    let onDone: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var meal: [String: Int] = [:]
    @State private var selected: Set<Int> = []
    @State private var qty: [Int: Double] = [:]
    @State private var leftovers = false
    @State private var portions = 2
    @State private var place = "fridge"
    @State private var busy = false
    @State private var showDifferent = false
    @State private var diffIngredient: String?
    @State private var diffTo = ""
    @State private var diffAlways = false
    @State private var diffDone: [String] = []
    @State private var labelled = false
    @State private var labels: [LeftoverBox] = []

    private var usable: [(product: RecipeMatchLine.Product, qty: Double)] { AmountScale.consumption(matches, factor: factor) }

    var body: some View {
        if !labels.isEmpty {
            NavigationStack {
                Form { BoxLabelsSection(store: store, boxes: labels) }
                    .themedList()
                    .navigationTitle(L("Put away – the labels"))
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Done")) { onDone(); dismiss() } } }
            }
        } else {
            form
        }
    }

    private var form: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Space.s5) {
                    if let people = ratings?.people, !people.isEmpty {
                        VStack(alignment: .leading, spacing: Theme.Space.s2) {
                            Text(LC("How was it? One tap per person at the table")).font(.subheadline.weight(.semibold))
                            ForEach(people) { p in
                                HStack(spacing: Theme.Space.s3) {
                                    PersonDot(name: p.name, color: p.color, size: 32)
                                    Text(p.name).font(.subheadline)
                                    Spacer(minLength: 4)
                                    RateButtons(value: meal[p.key], compact: true) { v in meal[p.key] = v }
                                }
                            }
                            Text(LC("Parents rate for the children. Ratings gently steer what gets suggested.")).font(.caption).foregroundStyle(Theme.ink3)
                        }
                    }
                    different
                    if !usable.isEmpty {
                        VStack(alignment: .leading, spacing: Theme.Space.s2) {
                            Text(LC("What did you use up?")).font(.subheadline.weight(.semibold))
                            VStack(spacing: 0) {
                                ForEach(usable, id: \.product.id) { x in consumeRow(x.product, proposed: x.qty); Divider() }
                            }
                            .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
                            .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).stroke(Theme.line, lineWidth: 1))
                            Text(LC("Only tick what's really gone – everything else stays in stock.")).font(.caption).foregroundStyle(Theme.ink3)
                        }
                    }
                    VStack(alignment: .leading, spacing: Theme.Space.s2) {
                        Text(LC("Leftovers?")).font(.subheadline.weight(.semibold))
                        Picker("", selection: $leftovers) {
                            Text(LC("No")).tag(false)
                            Text(LC("Yes")).tag(true)
                        }
                        .pickerStyle(.segmented)
                        if leftovers {
                            HStack {
                                Stepper(portions == 1 ? LC("1 portion") : LCF("%d portions", portions), value: $portions, in: 1...20)
                            }
                            Picker("", selection: $place) {
                                Text(LC("Fridge")).tag("fridge")
                                Text(LC("Freezer")).tag("freezer")
                            }
                            .pickerStyle(.segmented)
                            Text(place == "fridge" ? LC("They show up under “Eat me first” – best within 3 days.") : LC("Keeps about 3 months in the freezer."))
                                .font(.caption).foregroundStyle(Theme.ink3)
                            Toggle(L("Make a label for the container"), isOn: $labelled).tint(Theme.primary)
                        }
                    }
                    Button { Task { await save() } } label: { Text(busy ? LC("Saving…") : LC("Log it")) }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(busy)
                }
                .padding(Theme.Space.s4)
            }
            .canvasBackground()
            .navigationTitle(LC("Enjoy your meal!"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } } }
        }
    }

    private func consumeRow(_ p: RecipeMatchLine.Product, proposed: Double) -> some View {
        let on = selected.contains(p.id)
        let q = qty[p.id] ?? proposed
        let total = p.total ?? 0
        return HStack(spacing: Theme.Space.s3) {
            Button {
                if on { selected.remove(p.id) } else { selected.insert(p.id) }
            } label: {
                HStack(spacing: Theme.Space.s3) {
                    Image(systemName: on ? "checkmark.circle.fill" : "circle").font(.title3).foregroundStyle(on ? Theme.primary : Theme.ink3)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(p.name ?? "").font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                        Text(LCF("%@ %@ left", fmt(total), p.unit ?? "") + (on ? "" : " · −\(fmt(q))")).font(.caption).foregroundStyle(Theme.ink3)
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if on {
                Stepper("−\(fmt(q))", value: Binding(get: { q }, set: { qty[p.id] = max(1, min(max(1, total), $0)) }), in: 1...max(1, total), step: 1)
                    .fixedSize()
                    .font(.subheadline.monospacedDigit())
            }
        }
        .padding(.horizontal, Theme.Space.s3).padding(.vertical, 6)
        .frame(minHeight: 52)
    }

    private func fmt(_ d: Double) -> String { d.rounded() == d ? String(Int(d)) : String(format: "%.1f", d) }

    /// "Habt ihr etwas anders gemacht?" – just today or always (house version)
    @ViewBuilder private var different: some View {
        let lines = recipe.ingredients.filter { !$0.isPantry }.map(\.text)
        if !lines.isEmpty {
            if !showDifferent {
                Button { showDifferent = true } label: { Label(LC("Did you do anything differently?"), systemImage: "arrow.left.arrow.right") }
                    .buttonStyle(SecondaryButtonStyle())
            } else {
                VStack(alignment: .leading, spacing: Theme.Space.s2) {
                    Text(LC("What did you do differently?")).font(.subheadline.weight(.semibold))
                    if !diffDone.isEmpty { Text(diffDone.joined(separator: " · ")).font(.caption).foregroundStyle(Theme.primaryText) }
                    FlowLayout {
                        ForEach(lines, id: \.self) { l in
                            CookChip(title: l, on: diffIngredient == l) { diffIngredient = diffIngredient == l ? nil : l }
                        }
                    }
                    if let ing = diffIngredient {
                        TextField(LC("replaced with … (empty = left out)"), text: $diffTo)
                            .padding(10)
                            .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
                            .overlay(RoundedRectangle(cornerRadius: Theme.Radius.base).stroke(Theme.line, lineWidth: 1))
                        Toggle(LC("Always do it like this?"), isOn: $diffAlways).tint(Theme.primary)
                        let to = diffTo.trimmingCharacters(in: .whitespaces)
                        Button {
                            Task { await applyDifferent(ing, to.isEmpty ? nil : to) }
                        } label: {
                            Text((to.isEmpty ? LCF("Left out %@", ing) : LCF("%@ instead of %@", to, ing)) + " · " + (diffAlways ? LC("always") : LC("just today")))
                        }
                        .buttonStyle(SecondaryButtonStyle())
                    }
                    Text(LC("“Just today” only changes what counts as used up now. “Always” saves it as your way of cooking this recipe."))
                        .font(.caption).foregroundStyle(Theme.ink3)
                }
            }
        }
    }

    private func applyDifferent(_ ing: String, _ to: String?) async {
        do {
            try await store.api.variantChange(recipe.id, ingredient: ing, to: to, today: !diffAlways)
            diffDone.append(to.map { LCF("%@ instead of %@", $0, ing) } ?? LCF("without %@", ing))
            if diffAlways { feedback.say(LC("Saved as your way for next time")) }
            diffIngredient = nil
            diffTo = ""
            diffAlways = false
            store.touch("recipes")
        } catch { feedback.fail(error) }
    }

    /// household rating of this cooking: the mean of everybody's tap as meh / good / great
    private var mealRating: Int? {
        let vs = meal.values
        guard !vs.isEmpty else { return nil }
        let m = Double(vs.reduce(0, +)) / Double(vs.count)
        return m < 2 ? 1 : m < 4 ? 3 : 5
    }

    private func save() async {
        busy = true
        defer { busy = false }
        do {
            try? await store.api.saveMealRatings(recipe.id, meal)
            let consume = usable.filter { selected.contains($0.product.id) }.map { (productId: $0.product.id, qty: qty[$0.product.id] ?? $0.qty) }
            try await store.api.logCooked(recipe.id, rating: mealRating, consume: consume, planEntryId: planEntryId)
            var made: [LeftoverBox] = []
            if leftovers {
                if labelled {
                    do {
                        made = try await store.api.putAwayPlanned(planId: planEntryId, recipeId: recipe.id, name: nil, portions: Double(portions),
                                                                 boxes: nil, place: place, eatBy: nil, labelled: true)
                    } catch { feedback.fail(error) }
                } else {
                    do { try await store.api.saveLeftoverBoxes(recipeId: recipe.id, planEntryId: planEntryId, portions: portions, place: place) } catch { feedback.fail(error) }
                }
            }
            Haptics.success()
            store.touch("recipes", "stock")
            feedback.say(leftovers ? LCF("%@ logged – %d portions put away", recipe.title, portions) : LCF("%@ added to your cooking history", recipe.title))
            if !made.isEmpty { labels = made; return }
            onDone()
            dismiss()
        } catch { feedback.fail(error) }
    }
}

// MARK: - house version

/// "So machen wir das" – per ingredient: as is / replace / leave out, additions, note, our servings and minutes,
/// house rules on/off for this recipe. The original stays untouched.
struct VariantSheet: View {
    let store: ServerStore
    let recipe: RecipeFull
    let view: RecipeVariantView
    let feedback: CookFeedback
    let onDone: () -> Void
    @Environment(\.dismiss) private var dismiss

    struct Row: Identifiable {
        let id: Int
        let ingredient: String
        var mode: String
        var to: String
        var amount: String
    }
    @State private var rows: [Row] = []
    @State private var adds: [String] = []
    @State private var newAdd = ""
    @State private var note = ""
    @State private var servings = ""
    @State private var minutes = ""
    @State private var excluded: Set<Int> = []
    @State private var busy = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    ForEach($rows) { $row in
                        VStack(alignment: .leading, spacing: 8) {
                            Text(row.ingredient).font(.subheadline.weight(.medium)).strikethrough(row.mode == "remove")
                            Picker("", selection: $row.mode) {
                                Text(LC("as is")).tag("keep")
                                Text(LC("replace")).tag("swap")
                                Text(LC("leave out")).tag("remove")
                            }
                            .pickerStyle(.segmented)
                            if row.mode == "swap" {
                                TextField(LC("instead: e.g. rice"), text: $row.to)
                                TextField(LC("amount (optional)"), text: $row.amount)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                } footer: {
                    Text(LC("The original stays untouched. Suggestions, “used up” after cooking and the shopping list use your version."))
                }
                Section(LC("We add")) {
                    ForEach(adds.indices, id: \.self) { i in
                        TextField("", text: Binding(get: { adds[i] }, set: { adds[i] = $0 }))
                    }
                    .onDelete { adds.remove(atOffsets: $0) }
                    HStack {
                        TextField(LC("e.g. a handful of spinach"), text: $newAdd).onSubmit(addLine)
                        Button(action: addLine) { Image(systemName: "plus.circle.fill") }
                            .disabled(newAdd.trimmingCharacters(in: .whitespaces).isEmpty)
                            .accessibilityLabel(LC("Add"))
                    }
                }
                Section(LC("Note")) {
                    TextField(LC("e.g. less chilli for the kids, 10 min longer in the oven"), text: $note, axis: .vertical)
                }
                Section {
                    HStack {
                        Text(LC("Our servings"))
                        TextField(recipe.servings.map { String(Int($0)) } ?? "", text: $servings).keyboardType(.numberPad).multilineTextAlignment(.trailing)
                    }
                    HStack {
                        Text(LC("Our minutes"))
                        TextField(recipe.timeMin.map { String(Int($0)) } ?? "", text: $minutes).keyboardType(.numberPad).multilineTextAlignment(.trailing)
                    }
                }
                if !view.rules.isEmpty {
                    Section(LC("House rules for this recipe")) {
                        ForEach(view.rules) { rule in
                            Toggle(LCF("%@ instead of %@", rule.toText, rule.fromText), isOn: Binding(get: { !excluded.contains(rule.id) }, set: { _ in
                                Task {
                                    do {
                                        try await store.api.skipSwapRule(rule.id, recipeId: recipe.id)
                                        if excluded.contains(rule.id) { excluded.remove(rule.id) } else { excluded.insert(rule.id) }
                                        store.touch("recipes")
                                    } catch { feedback.fail(error) }
                                }
                            }))
                            .tint(Theme.primary)
                        }
                    }
                }
            }
            .themedList()
            .navigationTitle(LCF("Our way: %@", recipe.title))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button(L("Save")) { Task { await save() } }.disabled(busy) }
            }
            .onAppear(perform: fill)
        }
    }

    private func addLine() {
        let t = newAdd.trimmingCharacters(in: .whitespaces)
        guard !t.isEmpty else { return }
        adds.append(t)
        newAdd = ""
    }

    private func fill() {
        let permanent = (view.variant?.changes ?? []).filter { $0.day == nil }
        rows = recipe.ingredients.enumerated().map { n, i in
            let c = permanent.first { $0.kind != "add" && $0.ingredient == i.text }
            return Row(id: n, ingredient: i.text, mode: c.map { $0.kind == "swap" ? "swap" : "remove" } ?? "keep", to: c?.to ?? "", amount: c?.amount ?? "")
        }
        adds = permanent.filter { $0.kind == "add" }.compactMap(\.text)
        note = view.variant?.note ?? ""
        servings = view.variant?.servings.map(String.init) ?? ""
        minutes = view.variant?.timeMin.map(String.init) ?? ""
        excluded = Set(view.rules.filter { ($0.excludeIds ?? []).contains(recipe.id) }.map(\.id))
    }

    private func save() async {
        busy = true
        defer { busy = false }
        typealias C = RecipeVariantView.Change
        let today = (view.variant?.changes ?? []).filter { $0.day != nil }
        var changes: [C] = today
        changes += rows.filter { $0.mode == "remove" }.map { C(kind: "remove", ingredient: $0.ingredient) }
        changes += rows.filter { $0.mode == "swap" && !$0.to.trimmingCharacters(in: .whitespaces).isEmpty }.map {
            C(kind: "swap", ingredient: $0.ingredient, to: $0.to.trimmingCharacters(in: .whitespaces), amount: $0.amount.trimmingCharacters(in: .whitespaces).isEmpty ? nil : $0.amount)
        }
        changes += (adds + [newAdd]).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.map { C(kind: "add", text: $0) }
        do {
            try await store.api.saveVariant(recipe.id, changes: changes, note: note.trimmingCharacters(in: .whitespaces).isEmpty ? nil : note,
                                            servings: Int(servings), timeMin: Int(minutes))
            store.touch("recipes")
            feedback.say(LCF("Saved – %@ is now cooked your way", recipe.title))
            onDone()
            dismiss()
        } catch { feedback.fail(error) }
    }
}

// MARK: - house-wide swap rules

/// "So kochen wir" – swaps for every recipe (web: SwapRulesCard).
struct SwapRulesSection: View {
    let store: ServerStore
    let feedback: CookFeedback
    @State private var rules: [SwapRule] = []
    @State private var adding = false
    @State private var from = ""
    @State private var to = ""

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s3) {
            HStack {
                CookHeading(title: LC("How we cook"), hint: LC("Swaps that apply to every recipe – also to imported Cookidoo ones."))
                if !adding {
                    Button { adding = true } label: { Label(LC("Rule"), systemImage: "plus") }.font(.subheadline.weight(.semibold))
                }
            }
            if rules.isEmpty && !adding {
                Button { adding = true } label: {
                    Text(LC("For example: “oat milk instead of milk” or “rice instead of potatoes”."))
                        .font(.subheadline).foregroundStyle(Theme.ink3)
                        .padding(Theme.Space.s3).frame(maxWidth: .infinity, alignment: .leading)
                        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
                }
                .buttonStyle(.plain)
            }
            ForEach(rules) { x in
                HStack(spacing: Theme.Space.s3) {
                    Image(systemName: "arrow.left.arrow.right").foregroundStyle(Theme.primaryText)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(LCF("%@ instead of %@", x.toText, x.fromText)).font(.subheadline.weight(.semibold))
                        Text(scope(x)).font(.caption).foregroundStyle(Theme.ink3)
                    }
                    Spacer(minLength: 0)
                    Toggle("", isOn: Binding(get: { x.active ?? true }, set: { v in
                        Task { do { try await store.api.setSwapRule(x.id, active: v); store.touch("recipes") } catch { feedback.fail(error) }; await load() }
                    }))
                    .labelsHidden().tint(Theme.primary)
                    Button { Task { do { try await store.api.deleteSwapRule(x.id); store.touch("recipes") } catch { feedback.fail(error) }; await load() } } label: {
                        Image(systemName: "trash").frame(width: 36, height: 44)
                    }
                    .buttonStyle(.plain).foregroundStyle(Theme.ink3)
                    .accessibilityLabel(LC("Delete"))
                }
                .padding(.horizontal, Theme.Space.s3).padding(.vertical, 4)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
            }
            if adding {
                VStack(spacing: Theme.Space.s2) {
                    TextField(LC("instead of … (e.g. milk)"), text: $from).textFieldStyle(.roundedBorder)
                    TextField(LC("we use … (e.g. oat milk)"), text: $to).textFieldStyle(.roundedBorder)
                    HStack {
                        Button(L("Cancel")) { adding = false }
                        Spacer()
                        Button(LC("Save rule")) {
                            Task {
                                let f = from.trimmingCharacters(in: .whitespaces), t = to.trimmingCharacters(in: .whitespaces)
                                do {
                                    try await store.api.addSwapRule(from: f, to: t)
                                    feedback.say(LCF("From now on %@ instead of %@ in every recipe", t, f))
                                    from = ""; to = ""; adding = false
                                    store.touch("recipes")
                                } catch { feedback.fail(error) }
                                await load()
                            }
                        }
                        .buttonStyle(.borderedProminent).tint(Theme.primary)
                        .disabled(from.trimmingCharacters(in: .whitespaces).isEmpty || to.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
                .padding(Theme.Space.s3)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
            }
        }
        .task(id: store.revision("recipes")) { await load() }
    }

    private func scope(_ x: SwapRule) -> String {
        var parts: [String] = []
        if let ids = x.recipeIds, !ids.isEmpty { parts.append(LCF("%d recipes", ids.count)) }
        else if let t = x.tags, !t.isEmpty { parts.append(LCF("recipes tagged %@", t.joined(separator: ", "))) }
        else { parts.append(LC("all recipes")) }
        if let e = x.excludeIds, !e.isEmpty { parts.append(LCF("except %d", e.count)) }
        return parts.joined(separator: " · ")
    }

    private func load() async { rules = (try? await store.api.swapRules()) ?? rules }
}
