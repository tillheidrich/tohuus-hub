import SwiftUI
import UIKit

/// Kitchen mode (made for the iPad on the counter): a big week plan, a recipe step by step and the list to tick.
/// The screen stays on only while this mode is open (`isIdleTimerDisabled` is reset when it closes or the app leaves
/// the foreground).
struct KitchenModeView: View {
    let store: ServerStore
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var part: Part = .week
    @State private var plan: PlanResponse?
    @State private var recipeId: Int?
    @State private var error: String?

    enum Part: Hashable { case week, recipe, list }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Picker("", selection: $part) {
                    Label(L("Week"), systemImage: "calendar").tag(Part.week)
                    Label(L("Recipe"), systemImage: "list.number").tag(Part.recipe)
                    Label(L("List"), systemImage: "cart").tag(Part.list)
                }
                .pickerStyle(.segmented)
                .padding(Theme.Space.s4)
                if let error { ErrorBanner(message: error) { Task { await load() } }.padding(.horizontal) }
                switch part {
                case .week: KitchenWeek(store: store, plan: plan, open: openRecipe, reload: { await load() })
                case .recipe: KitchenRecipe(store: store, recipeId: recipeId, plan: plan, choose: { recipeId = $0 })
                case .list: KitchenList(store: store)
                }
            }
            .canvasBackground()
            .navigationTitle(L("Kitchen mode"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(L("Close")) { dismiss() }.keyboardShortcut(.cancelAction)
                }
                ToolbarItem(placement: .primaryAction) {
                    Group {
                        if sizeClass == .regular {
                            Label(L("Screen stays on"), systemImage: "sun.max.fill").labelStyle(.titleAndIcon)
                        } else {
                            Image(systemName: "sun.max.fill")
                        }
                    }
                    .font(.footnote)
                    .foregroundStyle(Theme.ink3)
                    .accessibilityLabel(L("Screen stays on"))
                }
            }
            .task(id: store.revision("recipes")) { await load() }
        }
        .onAppear { keepAwake(true) }
        .onDisappear { keepAwake(false) }
        .onChange(of: scenePhase) { _, phase in keepAwake(phase == .active) }
    }

    private func keepAwake(_ on: Bool) {
        UIApplication.shared.isIdleTimerDisabled = on
    }

    private func openRecipe(_ id: Int) {
        recipeId = id
        part = .recipe
    }

    private func load() async {
        do {
            plan = try await store.api.plan(from: ServerDate.day())
            if recipeId == nil {
                let today = ServerDate.day()
                recipeId = plan?.entries.first { $0.day == today && $0.recipeId != nil }?.recipeId
                    ?? plan?.entries.first { $0.recipeId != nil }?.recipeId
            }
            error = nil
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }
}

// MARK: - week

private struct KitchenWeek: View {
    let store: ServerStore
    let plan: PlanResponse?
    let open: (Int) -> Void
    let reload: () async -> Void
    @State private var dropTarget: String?

    var body: some View {
        ScrollView {
            if let plan {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 240), spacing: Theme.Space.s4)], spacing: Theme.Space.s4) {
                    ForEach(plan.days, id: \.self) { day in dayCard(day, entries: plan.entries.filter { $0.day == day }) }
                }
                .padding(Theme.Space.s4)
            } else {
                ProgressView().padding(.top, 80)
            }
        }
    }

    private func dayCard(_ day: String, entries: [PlanEntry]) -> some View {
        let isToday = day == ServerDate.day()
        return VStack(alignment: .leading, spacing: Theme.Space.s3) {
            Text(ServerDate.shortDay(day) ?? day)
                .font(.title3.weight(.semibold))
                .foregroundStyle(isToday ? Theme.primaryText : Theme.ink2)
            if entries.isEmpty {
                Text(L("Nothing planned")).font(.title3).foregroundStyle(Theme.ink3)
            }
            ForEach(entries) { e in
                Button {
                    if let rid = e.recipeId { open(rid) }
                } label: {
                    HStack {
                        Text(e.title).font(.title2.weight(.medium)).foregroundStyle(Theme.ink).multilineTextAlignment(.leading)
                        Spacer(minLength: 0)
                        if e.isCooked { Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.primary) }
                        else if e.recipeId != nil { Image(systemName: "chevron.right").foregroundStyle(Theme.ink3) }
                    }
                    .frame(minHeight: 56)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .hoverEffect(.highlight)
                .draggable(PlanDrag(id: e.id).payload)
            }
        }
        .padding(Theme.Space.s5)
        .frame(maxWidth: .infinity, minHeight: 160, alignment: .topLeading)
        .background(dropTarget == day ? Theme.primarySoft : Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
        .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).stroke(isToday ? Theme.primary : Theme.line, lineWidth: isToday ? 2 : 1))
        .dropDestination(for: String.self) { items, _ in
            guard let id = items.compactMap(PlanDrag.init(payload:)).first?.id else { return false }
            Task {
                try? await store.api.movePlan(id, day: day)
                store.touch("recipes")
                await reload()
            }
            return true
        } isTargeted: { on in dropTarget = on ? day : (dropTarget == day ? nil : dropTarget) }
    }
}

// MARK: - recipe step by step

private struct KitchenRecipe: View {
    let store: ServerStore
    let recipeId: Int?
    let plan: PlanResponse?
    let choose: (Int) -> Void
    @State private var recipe: Recipe?
    @State private var step = 0
    @State private var error: String?
    @Environment(\.horizontalSizeClass) private var sizeClass

    var body: some View {
        Group {
            if let recipe {
                content(recipe)
            } else if let error {
                ErrorBanner(message: error).padding()
            } else if recipeId == nil {
                chooser
            } else {
                ProgressView().padding(.top, 80)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .task(id: recipeId) { await load() }
    }

    private var chooser: some View {
        EmptyStateView(systemImage: "list.number", title: L("No recipe chosen."),
                       message: L("Open a recipe from the week, or plan one first."))
    }

    private func content(_ r: Recipe) -> some View {
        HStack(alignment: .top, spacing: Theme.Space.s6) {
            if sizeClass == .regular {
                ScrollView {
                    VStack(alignment: .leading, spacing: Theme.Space.s3) {
                        Text(L("Ingredients")).font(.title3.weight(.semibold))
                        ForEach(r.ingredients, id: \.stableId) { i in
                            Text(i.text).font(.title3).foregroundStyle(Theme.ink)
                        }
                    }
                    .padding(Theme.Space.s4)
                }
                .frame(width: 300)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
            }
            VStack(alignment: .leading, spacing: Theme.Space.s5) {
                Text(r.title).font(Theme.title(34))
                if r.steps.isEmpty {
                    Text(L("This recipe has no steps.")).font(.title2).foregroundStyle(Theme.ink2)
                } else {
                    let i = min(step, r.steps.count - 1)
                    Text(LF("Step %d of %d", i + 1, r.steps.count))
                        .font(.headline).foregroundStyle(Theme.primaryText)
                    ScrollView {
                        Text(r.steps[i].text)
                            .font(.system(size: 34, weight: .regular))
                            .foregroundStyle(Theme.ink)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .accessibilityAddTraits(.updatesFrequently)
                    }
                    HStack(spacing: Theme.Space.s4) {
                        Button {
                            withAnimation { step = max(0, i - 1) }
                        } label: {
                            Label(L("Back"), systemImage: "chevron.left").frame(maxWidth: .infinity, minHeight: 64)
                        }
                        .buttonStyle(SecondaryButtonStyle())
                        .disabled(i == 0)
                        .keyboardShortcut(.leftArrow, modifiers: [])
                        if i + 1 < r.steps.count {
                            Button {
                                withAnimation { step = i + 1 }
                            } label: {
                                Label(L("Next"), systemImage: "chevron.right").frame(maxWidth: .infinity, minHeight: 64)
                            }
                            .buttonStyle(PrimaryButtonStyle())
                            .keyboardShortcut(.rightArrow, modifiers: [])
                        } else {
                            Button {
                                Task {
                                    try? await store.api.cooked(r.id)
                                    Haptics.success()
                                    store.touch("recipes", "stock")
                                }
                            } label: {
                                Label(L("Cooked"), systemImage: "checkmark").frame(maxWidth: .infinity, minHeight: 64)
                            }
                            .buttonStyle(PrimaryButtonStyle())
                        }
                    }
                    .font(.title3.weight(.semibold))
                }
            }
        }
        .padding(Theme.Space.s5)
    }

    private func load() async {
        guard let recipeId else { recipe = nil; return }
        do {
            recipe = try await store.api.recipe(recipeId)
            step = 0
            error = nil
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }
}

// MARK: - list to tick

private struct KitchenList: View {
    let store: ServerStore
    @State private var lastTicked: ShopItem?

    var body: some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 300), spacing: Theme.Space.s3)], spacing: Theme.Space.s3) {
                ForEach(store.list.openItems) { item in
                    Button {
                        Haptics.tick()
                        lastTicked = item
                        Task { await store.setChecked(item, true) }
                    } label: {
                        HStack(spacing: Theme.Space.s3) {
                            Image(systemName: "circle").font(.system(size: 34)).foregroundStyle(Theme.lineStrong)
                            VStack(alignment: .leading) {
                                Text([item.qtyLabel, item.productName ?? item.text].compactMap { $0 }.joined(separator: " "))
                                    .font(.title2).foregroundStyle(Theme.ink)
                                Text(item.originLine).font(.footnote).foregroundStyle(Theme.ink3).lineLimit(1)
                            }
                            Spacer(minLength: 0)
                        }
                        .padding(Theme.Space.s4)
                        .frame(minHeight: 80)
                        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
                        .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).stroke(Theme.line, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                    .hoverEffect(.lift)
                }
            }
            .padding(Theme.Space.s4)
            if store.list.openItems.isEmpty {
                EmptyStateView(systemImage: "checkmark.circle", title: L("Nothing missing right now."))
            }
        }
        .safeAreaInset(edge: .bottom) {
            if let item = lastTicked {
                HStack {
                    Text(LF("“%@” ticked off", item.productName ?? item.text)).lineLimit(1)
                    Spacer()
                    Button(L("Undo")) {
                        lastTicked = nil
                        var back = item
                        back.checkedAt = "x"
                        Task { await store.setChecked(back, false) }
                    }
                    .fontWeight(.semibold)
                    .foregroundStyle(Theme.mustard)
                }
                .font(.title3)
                .foregroundStyle(Theme.canvas)
                .padding(Theme.Space.s4)
                .background(Theme.ink, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
                .padding(Theme.Space.s4)
                .task(id: item.id) {
                    try? await Task.sleep(nanoseconds: 5_000_000_000)
                    if lastTicked?.id == item.id { lastTicked = nil }
                }
            }
        }
    }
}
