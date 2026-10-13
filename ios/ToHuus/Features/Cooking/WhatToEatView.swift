import SwiftUI

/// "Was essen wir heute?" (web: pages/WhatToEat.tsx) – fast, decisive dinner helper from what is in the house.
struct WhatToEatSection: View {
    let store: ServerStore
    let feedback: CookFeedback
    let openRecipe: (RecipeRef) -> Void
    var openImport: () -> Void = {}
    @State private var filters = WteFilters.load()
    @State private var data: WhatToEat?
    @State private var error: String?
    @State private var loading = false
    @State private var unsupported = false
    @State private var pick: WtePick?
    @State private var seen: [String] = []
    @State private var picking = false
    @State private var swap: SwapRequest?
    @State private var onList: Set<String> = []
    /// older servers without /api/cook2: the previous idea list
    var fallback: AnyView?

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s4) {
            if unsupported, let fallback {
                fallback
            } else if let error, data == nil {
                ErrorBanner(message: error) { Task { await load() } }
            } else if let d = data {
                if d.empty == true { emptyHelp } else { content(d) }
            } else {
                RoundedRectangle(cornerRadius: Theme.Radius.lg).fill(Theme.surface2).frame(height: 220)
                    .overlay(ProgressView())
            }
        }
        .task(id: "\(store.revision("recipes"))-\(store.revision("stock"))-\(filters.query.description)") { await load() }
        .sheet(item: $swap) { r in SwapSheet(store: store, req: r, feedback: feedback) { Task { await load() }; openRecipe(RecipeRef(id: r.recipeId)) } }
    }

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            data = try await store.api.whatToEat(filters)
            error = nil
        } catch {
            let e = APIError.from(error)
            if e == .notFound { unsupported = true }
            self.error = e.localizedDescription
        }
    }

    private func setFilters(_ f: WteFilters) {
        filters = f
        f.save()
        pick = nil
        seen = []
    }

    @ViewBuilder
    private func content(_ d: WhatToEat) -> some View {
        ForEach(d.planned.filter { $0.cooked != true }) { p in plannedCard(p) }

        VStack(alignment: .leading, spacing: 6) {
            Button { Task { await roll(again: pick != nil) } } label: {
                Label(pick == nil ? LC("You decide for us") : LC("Something else"), systemImage: pick == nil ? "dice" : "arrow.triangle.2.circlepath")
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(picking || d.nothing)
            let counts = [d.ready.isEmpty ? nil : (d.ready.count == 1 ? LC("1 works right now") : LCF("%d work right now", d.ready.count)),
                          d.leftovers.isEmpty ? nil : LC("leftovers waiting")].compactMap { $0 }
            Text(counts.isEmpty ? LC("Picks among what fits best today.") : counts.joined(separator: " · "))
                .font(.caption).foregroundStyle(Theme.ink3)
        }
        if let pick { pickCard(pick) }

        filterChips(d)

        if d.nothing {
            Text(filters.isActive ? LC("Nothing fits these filters right now. Try fewer filters – or plan something new.")
                 : LC("Nothing fits with what’s in the house right now. Pick a recipe below and put the missing things on the list."))
                .font(.subheadline).foregroundStyle(Theme.ink2)
                .padding(Theme.Space.s4).frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
        }
        if !d.leftovers.isEmpty {
            CookHeading(title: LC("Leftovers first"), hint: LC("already cooked – just warm up"))
            VStack(spacing: 0) { ForEach(d.leftovers) { l in leftoverRow(l); Divider() } }
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
                .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).stroke(Theme.line, lineWidth: 1))
        }
        if !d.ready.isEmpty {
            CookHeading(title: LC("Works right now"), hint: LC("everything is in the house"))
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Theme.Space.s3) { ForEach(d.ready) { it in ideaTile(it, width: 220) } }
            }
        }
        if !d.oneMissing.isEmpty {
            CookHeading(title: LC("Only one thing missing"), hint: LC("put it on the list – or use something else"))
            ForEach(d.oneMissing) { it in oneMissingRow(it) }
        }
        if !d.quick.isEmpty && filters.max != "20" {
            CookHeading(title: LC("Quick (≤ 20 min)"))
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Theme.Space.s3) { ForEach(d.quick) { it in ideaTile(it, width: 170) } }
            }
        }
    }

    private func filterChips(_ d: WhatToEat) -> some View {
        FlowLayout {
            if d.hasThermomix == true {
                CookChip(title: "Thermomix", on: filters.tm == "1") { var f = filters; f.tm = f.tm == "1" ? "" : "1"; setFilters(f) }
                CookChip(title: LC("Without Thermomix"), on: filters.tm == "0") { var f = filters; f.tm = f.tm == "0" ? "" : "0"; setFilters(f) }
            }
            CookChip(title: LC("≤ 20 min"), systemImage: "clock", on: filters.max == "20") { var f = filters; f.max = f.max == "20" ? "" : "20"; setFilters(f) }
            CookChip(title: LC("≤ 40 min"), on: filters.max == "40") { var f = filters; f.max = f.max == "40" ? "" : "40"; setFilters(f) }
            if d.hasVegetarian == true {
                CookChip(title: LC("Vegetarian"), systemImage: "leaf", on: filters.veg) { var f = filters; f.veg.toggle(); setFilters(f) }
            }
            CookChip(title: LC("Nothing new to buy"), systemImage: "cart", on: filters.noshop) { var f = filters; f.noshop.toggle(); setFilters(f) }
            if filters.isActive {
                CookChip(title: LC("Reset"), systemImage: "xmark", on: false) { setFilters(WteFilters()) }
            }
        }
    }

    private func plannedCard(_ p: WhatToEat.Planned) -> some View {
        Button { if let r = p.recipeId { openRecipe(RecipeRef(id: r, planEntryId: p.id)) } } label: {
            HStack(spacing: Theme.Space.s3) {
                RemoteImage(url: store.api.imageURL(p.imagePath), api: store.api, placeholder: "calendar")
                    .frame(width: 64, height: 64).clipShape(RoundedRectangle(cornerRadius: Theme.Radius.base))
                VStack(alignment: .leading, spacing: 3) {
                    Text([p.slot == "mittag" ? LC("Planned for lunch") : LC("Planned for tonight"), p.source == "cookidoo" ? "Cookidoo" : nil, p.timeMin.map { LCF("%d min", Int($0)) }].compactMap { $0 }.joined(separator: " · "))
                        .font(.caption.weight(.semibold)).foregroundStyle(Theme.primaryText)
                    Text(p.title).font(.headline).foregroundStyle(Theme.ink).multilineTextAlignment(.leading)
                    if let why = p.why { Text(why).font(.caption).foregroundStyle(p.ready == false ? Theme.low : Theme.ink3) }
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").foregroundStyle(Theme.ink3)
            }
            .padding(Theme.Space.s3)
            .background(Theme.primarySoft, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func tags(_ it: WteCard) -> [String] {
        var t: [String] = []
        if it.thermomix == true { t.append("Thermomix") }
        if let m = it.timeMin { t.append(LCF("%d min", Int(m))) }
        if it.favorite == true { t.append(LC("Favourite")) }
        if !(it.swaps ?? []).isEmpty { t.append(LC("our way")) }
        if !it.missing.isEmpty { t.append(LCF("missing: %@", it.missing.map(\.text).joined(separator: ", "))) }
        return t
    }

    private func ideaTile(_ it: WteCard, width: CGFloat) -> some View {
        Button { if let r = it.recipeId { openRecipe(RecipeRef(id: r)) } } label: {
            VStack(alignment: .leading, spacing: 6) {
                RemoteImage(url: store.api.imageURL(it.imagePath), api: store.api, placeholder: "fork.knife")
                    .frame(width: width, height: width * 0.62)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.base))
                Text(it.title).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink).lineLimit(2).multilineTextAlignment(.leading)
                let t = tags(it)
                if !t.isEmpty { Text(t.joined(separator: " · ")).font(.caption2).foregroundStyle(Theme.ink3).lineLimit(1) }
                if let why = it.why { Text(why).font(.caption).foregroundStyle(Theme.primaryText).lineLimit(2).multilineTextAlignment(.leading) }
                ForEach(it.warnings ?? [], id: \.self) { w in Label(w, systemImage: "exclamationmark.triangle").font(.caption2).foregroundStyle(Theme.low) }
            }
            .frame(width: width, alignment: .leading)
            .padding(Theme.Space.s2)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
            .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).stroke(Theme.line, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    private func leftoverRow(_ l: WteCard) -> some View {
        HStack(spacing: Theme.Space.s3) {
            Image(systemName: "takeoutbag.and.cup.and.straw").foregroundStyle(Theme.primaryText)
                .frame(width: 40, height: 40).background(Theme.primarySoft, in: Circle())
            VStack(alignment: .leading, spacing: 2) {
                Text(l.title).font(.body.weight(.semibold))
                if let why = l.why { Text(why).font(.caption).foregroundStyle((l.daysLeft ?? 9) <= 1 ? Theme.low : Theme.ink3) }
            }
            Spacer(minLength: 0)
            Button(LC("We’ll eat it")) {
                Task {
                    guard let pid = l.productId else { return }
                    do {
                        let left = try await store.api.eatLeftover(pid)
                        Haptics.success()
                        feedback.say(left > 0 ? LCF("%@: enjoy – %d left", l.title, left) : LCF("%@: enjoy!", l.title))
                        store.touch("stock")
                    } catch { feedback.fail(error) }
                }
            }
            .buttonStyle(.bordered).tint(Theme.primary)
        }
        .padding(Theme.Space.s3)
    }

    private func oneMissingRow(_ it: WteCard) -> some View {
        let m = it.missing.first
        return VStack(alignment: .leading, spacing: Theme.Space.s3) {
            Button { if let r = it.recipeId { openRecipe(RecipeRef(id: r)) } } label: {
                HStack(spacing: Theme.Space.s3) {
                    RemoteImage(url: store.api.imageURL(it.imagePath), api: store.api, placeholder: "fork.knife")
                        .frame(width: 52, height: 52).clipShape(RoundedRectangle(cornerRadius: Theme.Radius.sm))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(it.title).font(.body.weight(.semibold)).foregroundStyle(Theme.ink).multilineTextAlignment(.leading)
                        if let why = it.why { Text(why).font(.caption).foregroundStyle(Theme.ink3).multilineTextAlignment(.leading) }
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if let m, let rid = it.recipeId {
                FlowLayout {
                    let done = onList.contains(it.key)
                    CookChip(title: done ? LC("on the list") : LCF("%@ on the list", m.text), systemImage: done ? "checkmark" : "cart.badge.plus", on: done) {
                        guard !done else { return }
                        Task {
                            do {
                                let created = try await store.api.missingLineToList(recipeId: rid, text: m.text)
                                onList.insert(it.key)
                                store.touch("shopping")
                                await store.refreshList()
                                feedback.say(created ? LCF("%@ is on the shopping list", m.text) : LCF("%@ was already on the list", m.text))
                            } catch { feedback.fail(error) }
                        }
                    }
                    ForEach(m.alternatives, id: \.productId) { a in
                        CookChip(title: LCF("%@ instead", a.name), systemImage: "arrow.left.arrow.right", on: false) {
                            swap = SwapRequest(recipeId: rid, title: it.title, from: m.text, to: a.name)
                        }
                    }
                }
            }
        }
        .padding(Theme.Space.s3)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
        .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).stroke(Theme.line, lineWidth: 1))
    }

    private func pickCard(_ p: WtePick) -> some View {
        let it = p.item
        let label = p.bucket == "leftovers" ? LC("Leftovers first") : p.bucket == "ready" ? LC("Works right now") : LC("Only one thing missing")
        return VStack(alignment: .leading, spacing: Theme.Space.s3) {
            HStack {
                Text(LC("Today we eat …")).font(.caption.weight(.semibold)).foregroundStyle(Theme.onBlock.opacity(0.8))
                Spacer()
                Button { pick = nil; seen = [] } label: { Image(systemName: "xmark").frame(width: 36, height: 36) }
                    .foregroundStyle(Theme.onBlock)
                    .accessibilityLabel(L("Close"))
            }
            if it.imagePath != nil {
                RemoteImage(url: store.api.imageURL(it.imagePath), api: store.api, placeholder: "fork.knife")
                    .frame(height: 150).frame(maxWidth: .infinity)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.base))
            }
            Text(it.title).font(Theme.title(26)).foregroundStyle(Theme.onBlock)
            Text("\(label) · \(it.why ?? "")").font(.subheadline).foregroundStyle(Theme.onBlock.opacity(0.85))
            FlowLayout(spacing: 8) {
                Button {
                    if let r = it.recipeId, !it.isLeftover { openRecipe(RecipeRef(id: r)) }
                    else if it.isLeftover, let pid = it.productId { Task { _ = try? await store.api.eatLeftover(pid); feedback.say(LCF("%@: enjoy!", it.title)); store.touch("stock") } }
                } label: {
                    Text(it.isLeftover ? LC("Let’s have this") : LC("Let’s cook this")).font(.subheadline.weight(.semibold))
                        .padding(.horizontal, 16).frame(minHeight: 44)
                        .background(Theme.mustard, in: Capsule()).foregroundStyle(Theme.ink)
                }
                .buttonStyle(.plain)
                Button { Task { await roll(again: true) } } label: {
                    Label(LC("Something else"), systemImage: "arrow.triangle.2.circlepath").font(.subheadline.weight(.semibold))
                        .padding(.horizontal, 14).frame(minHeight: 44)
                        .overlay(Capsule().stroke(Theme.onBlock.opacity(0.5), lineWidth: 1)).foregroundStyle(Theme.onBlock)
                }
                .buttonStyle(.plain)
                .disabled(picking)
                if !it.isLeftover, let rid = it.recipeId, let m = it.missing.first, let alt = m.alternatives.first {
                    Button { swap = SwapRequest(recipeId: rid, title: it.title, from: m.text, to: alt.name) } label: {
                        Label(LCF("%@ instead", alt.name), systemImage: "arrow.left.arrow.right").font(.subheadline.weight(.semibold))
                            .padding(.horizontal, 14).frame(minHeight: 44)
                            .overlay(Capsule().stroke(Theme.onBlock.opacity(0.5), lineWidth: 1)).foregroundStyle(Theme.onBlock)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(Theme.Space.s4)
        .background(Theme.block, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
        .transition(.opacity)
    }

    private func roll(again: Bool) async {
        picking = true
        defer { picking = false }
        do {
            let exclude = again ? seen : []
            guard let p = try await store.api.pickMeal(filters, exclude: exclude) else {
                feedback.say(LC("Nothing to choose from yet."))
                return
            }
            Haptics.tick()
            Motion.perform(Motion.quick) { pick = p }
            seen = p.cycled == true ? [p.item.key] : exclude + [p.item.key]
        } catch { feedback.fail(error) }
    }

    private var emptyHelp: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s3) {
            Text(LC("No recipes yet – so no suggestions yet.")).font(.headline)
            Text(LC("Add a few favourite recipes. After that this screen answers “what do we eat today?” from what’s in the house."))
                .font(.subheadline).foregroundStyle(Theme.ink2)
            Button { openImport() } label: { Label(L("Add recipe"), systemImage: "plus") }
                .buttonStyle(PrimaryButtonStyle())
        }
        .padding(Theme.Space.s4)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
    }
}

// MARK: - "take X instead"

struct SwapRequest: Identifiable, Hashable {
    let recipeId: Int
    let title: String
    let from: String
    let to: String
    var id: String { "\(recipeId)-\(from)-\(to)" }
}

struct SwapSheet: View {
    let store: ServerStore
    let req: SwapRequest
    let feedback: CookFeedback
    let onDone: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var busy = false

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: Theme.Space.s4) {
                Text(LC("The original recipe stays as it is. Shopping list, suggestions and “used up” follow your version."))
                    .font(.subheadline).foregroundStyle(Theme.ink2)
                Button(LC("Just today")) { Task { await run("today") } }.buttonStyle(PrimaryButtonStyle())
                Button(LCF("Always for “%@”", req.title)) { Task { await run("recipe") } }.buttonStyle(SecondaryButtonStyle())
                Button(LC("Always, in every recipe")) { Task { await run("always") } }.buttonStyle(SecondaryButtonStyle())
                Spacer()
            }
            .disabled(busy)
            .padding(Theme.Space.s4)
            .canvasBackground()
            .navigationTitle(LCF("%@ instead of %@", req.to, req.from))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } } }
        }
        .presentationDetents([.medium])
    }

    private func run(_ mode: String) async {
        busy = true
        defer { busy = false }
        do {
            if mode == "always" {
                try await store.api.addSwapRule(from: req.from, to: req.to)
                feedback.say(LCF("From now on %@ instead of %@ in every recipe", req.to, req.from))
            } else {
                try await store.api.variantChange(req.recipeId, ingredient: req.from, to: req.to, today: mode == "today")
                feedback.say(mode == "today" ? LCF("Today with %@ instead of %@", req.to, req.from) : LCF("%@: from now on with %@", req.title, req.to))
            }
            store.touch("recipes")
            dismiss()
            if mode != "always" { onDone() }
        } catch { feedback.fail(error) }
    }
}
