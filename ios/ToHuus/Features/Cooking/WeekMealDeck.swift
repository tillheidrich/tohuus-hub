import SwiftUI

/// "Was essen wir diese Woche?" (15 Oct 2026): the recipe suggestions of "Ideen durchblättern" (GET /api/recipes/suggest),
/// as a short deck. Right = "Gern" puts it on the next free evening of the coming seven days (POST /api/plan2/entries,
/// the same call as planning a meal by hand), left = "Heute nicht". Days marked "not at home" or "eating out" and
/// evenings that already have a meal are skipped. At the end: "N Abende geplant".
struct WeekMealDeckSheet: View {
    let store: ServerStore
    var onPlanned: () -> Void = {}
    @Environment(\.dismiss) private var dismiss
    @State private var suggestions: [RecipeSuggestion]?
    /// the free evenings, earliest first – used up as meals are planned
    @State private var free: [String] = []
    @State private var error: String?

    private let actions = [
        SwipeDeckAction(id: "no", title: L("Not today"), systemImage: "xmark", direction: .left),
        SwipeDeckAction(id: "yes", title: L("Yes, please"), systemImage: "heart", direction: .right, prominent: true),
    ]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Space.s4) {
                    Text(free.isEmpty || suggestions == nil ? L("Swipe right for what you fancy – it goes on the next free evening.")
                                                            : LF("Swipe right for what you fancy – it goes on the next free evening. Free: %@.", free.map(CookDay.weekday).joined(separator: ", ")))
                        .font(.subheadline).foregroundStyle(Theme.ink2)
                        .fixedSize(horizontal: false, vertical: true)
                    if let error { ErrorBanner(message: error) { Task { await load() } } }
                    if let s = suggestions {
                        if s.isEmpty {
                            EmptyStateView(systemImage: "fork.knife", title: L("No suggestions yet"),
                                           message: L("Add a few favorite recipes – by link, photo (e.g. a HelloFresh card) or via Claude/ChatGPT."))
                        } else if free.isEmpty && planned == 0 {
                            SwipeDeckEnd(systemImage: "calendar", title: L("Every evening this week is planned."),
                                         message: L("Change the week plan under Week."))
                        } else {
                            SwipeDeck(items: s, actions: actions, onAction: act) { x in
                                RecipeSuggestionFace(suggestion: x, api: store.api, imageHeight: 200)
                                    .padding(-Theme.Space.s5)
                                    .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
                            } end: { counts in
                                let n = counts["yes"] ?? 0
                                SwipeDeckEnd(systemImage: "calendar.badge.checkmark",
                                             title: n == 0 ? L("Nothing planned – that’s fine too.") : n == 1 ? L("1 evening planned") : LF("%d evenings planned", n),
                                             message: n > 0 ? L("Everything is in the week plan. Missing things go on the list from there.") : nil)
                            }
                        }
                    } else if error == nil {
                        ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
                    }
                }
                .padding(Theme.Space.s4)
            }
            .canvasBackground()
            .navigationTitle(L("What shall we eat this week?"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Done")) { dismiss() } } }
            .task { await load() }
        }
    }

    @State private var planned = 0

    private func act(_ s: RecipeSuggestion, _ a: SwipeDeckAction) async -> Bool {
        guard a.id == "yes" else { return true }
        guard let day = free.first else {
            error = L("No free evening left this week.")
            return false
        }
        do {
            try await store.api.planEntry(day: day, slot: "abend", recipeId: s.recipe.id, title: nil, servings: nil)
            free.removeFirst()
            planned += 1
            error = nil
            Haptics.success()
            onPlanned()
            return true
        } catch {
            self.error = APIError.from(error).localizedDescription
            return false
        }
    }

    private func load() async {
        // late in the evening, tonight is no longer a free evening
        let start = Calendar.current.component(.hour, from: Date()) >= 19 ? CookDay.add(CookDay.today(), 1) : CookDay.today()
        do {
            async let sug = store.api.recipeSuggestions(thermomix: nil, limit: 10)
            async let plan = store.api.weekPlan(from: start, days: 7)
            let overlay = try? await store.api.weekOverlay(from: start, days: 7)
            let p = try await plan
            let marked = Set((overlay?.marks ?? []).map(\.day))
            let days = p.days.isEmpty ? (0..<7).map { CookDay.add(start, $0) } : p.days
            free = days.filter { d in
                !marked.contains(d) && !p.entries.contains { $0.day == d && ($0.slot ?? "abend") == "abend" }
            }
            suggestions = try await sug
            error = nil
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }
}

/// Kochen › "Was kochen wir?": the way in to the deck.
struct WeekMealDeckEntry: View {
    let store: ServerStore
    var onPlanned: () -> Void = {}
    @State private var open = false

    var body: some View {
        Button { open = true } label: {
            HStack(spacing: Theme.Space.s3) {
                Image(systemName: "rectangle.stack").font(.title2).foregroundStyle(Theme.primaryText)
                    .frame(width: 44, height: 44).background(Theme.primarySoft, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(L("What shall we eat this week?")).font(.headline).foregroundStyle(Theme.ink)
                    Text(L("A few ideas, one at a time – yes puts it on a free evening."))
                        .font(.caption).foregroundStyle(Theme.ink2).multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(Theme.ink3).accessibilityHidden(true)
            }
            .padding(Theme.Space.s3)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
            .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).stroke(Theme.line, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .sheet(isPresented: $open) { WeekMealDeckSheet(store: store, onPlanned: onPlanned) }
    }
}
